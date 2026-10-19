from flask import Flask, jsonify, render_template, request
from pymongo import MongoClient
from datetime import datetime, timezone
import csv
import math
import os
import random
import re
import threading
from collections import deque

from volume_engine import run_volume_stream
from streaming_algos import BloomFilter, DGIM, FMSketch, RecentWindow, FM_CORRECTION

app = Flask(__name__)

# MongoDB connection
client = MongoClient("mongodb://localhost:27017/")
db = client["healthpulse"]


# ---------------------------------------------------------
# API ERROR HANDLERS
# Keep API failures JSON so the frontend never tries to parse
# an HTML Flask error page as JSON.
# ---------------------------------------------------------

@app.errorhandler(404)
def handle_not_found(error):
    if request.path.startswith("/api/"):
        return jsonify({"error": "API endpoint not found", "path": request.path}), 404
    return error


@app.errorhandler(Exception)
def handle_api_exception(error):
    if request.path.startswith("/api/"):
        app.logger.exception("API error on %s", request.path)
        return jsonify({
            "error": str(error) or "Internal server error",
            "endpoint": request.path
        }), 500
    raise error


# ---------------------------------------------------------
# HOME
# ---------------------------------------------------------

@app.route("/")
def home():
    return render_template("dashboard.html")


# ---------------------------------------------------------
# DISEASE COUNTS
# Historical result (computed with Python/Pandas)
# ---------------------------------------------------------

@app.route("/api/disease-counts")
def disease_counts():
    data = list(db.disease_counts.find({}, {"_id": 0}))
    return jsonify(data)


# ---------------------------------------------------------
# AVERAGE LENGTH OF STAY
# Historical result (computed with Python/Pandas)
# ---------------------------------------------------------

@app.route("/api/los")
def los():
    data = list(db.los_by_admission.find({}, {"_id": 0}))
    return jsonify(data)


# ---------------------------------------------------------
# BLOOM FILTER ALERTS
# Existing simulated stream results
# ---------------------------------------------------------

@app.route("/api/bloom-alerts")
def bloom_alerts():
    data = list(db.bloom_alerts.find({}, {"_id": 0}))
    return jsonify(data)


# ---------------------------------------------------------
# DGIM RESULTS
# Historical chronological replay
# ---------------------------------------------------------

@app.route("/api/dgim-results")
def dgim_results():
    data = list(
        db.dgim_results.find({}, {"_id": 0}).sort("event_number", 1)
    )
    return jsonify(data)


# ---------------------------------------------------------
# FLAJOLET-MARTIN RESULT
# Existing simulated locality estimation
# ---------------------------------------------------------

@app.route("/api/fm-results")
def fm_results():
    data = list(db.fm_results.find({}, {"_id": 0}))
    return jsonify(data)


# ---------------------------------------------------------
# DASHBOARD SUMMARY
# ---------------------------------------------------------

@app.route("/api/summary")
def summary():
    return jsonify({
        "disease_records": db.disease_counts.count_documents({}),
        "los_records": db.los_by_admission.count_documents({}),
        "bloom_alerts": db.bloom_alerts.count_documents({}),
        "dgim_records": db.dgim_results.count_documents({}),
        "fm_results": db.fm_results.count_documents({})
    })


# =========================================================
# INTERACTIVE STREAMING ALGORITHM IMPLEMENTATION
# =========================================================
# Each algorithm keeps a COMPACT STATE that is updated once per arriving event
# (see streaming_algos.py). Nothing is re-read from MongoDB per event; MongoDB
# only stores an audit trail and is used to rebuild the state after a restart.

NOTIFIABLE_DISEASES = {
    "cholera",
    "dengue",
    "malaria",
    "measles",
    "tuberculosis",
    "typhoid"
}

BLOOM_SIZE = 32
BLOOM_HASH_COUNT = 3
DGIM_WINDOW = 10
DGIM_SPIKE_THRESHOLD = 6

# Bloom filter: built ONCE from the notifiable list.
bloom_filter = BloomFilter(BLOOM_SIZE, BLOOM_HASH_COUNT)
for _name in NOTIFIABLE_DISEASES:
    bloom_filter.add(_name)


def bloom_check(disease):
    positions = bloom_filter.positions(disease)
    return {
        "filter_size": BLOOM_SIZE,
        "hash_functions": BLOOM_HASH_COUNT,
        "positions": positions,
        "bits_at_positions": [bloom_filter.bit(p) for p in positions],
        "possibly_notifiable": bloom_filter.might_contain(disease),
        "confirmed_by_list": disease.strip().lower() in NOTIFIABLE_DISEASES,
        "notifiable_diseases": sorted(NOTIFIABLE_DISEASES)
    }


class StreamState:
    """
    The live state of the stream.

      clock            event counter = DGIM timestamp
      dgim[disease]    one DGIM (a few buckets) per disease; a '0' costs nothing
      fm               Flajolet-Martin sketch: 16 small integers
      recent / exact_localities
                       kept ONLY to show an exact value next to each estimate
                       (validation for the demo, not used for the estimates)
    """

    def __init__(self):
        self.lock = threading.RLock()
        self.clear()

    def clear(self):
        with self.lock:
            self.clock = 0
            self.dgim = {}
            self.fm = FMSketch()
            self.locality_events = 0
            self.recent = RecentWindow(DGIM_WINDOW)
            self.exact_localities = set()

    def process(self, disease, locality):
        """Feed ONE event to DGIM and Flajolet-Martin; return their results."""
        with self.lock:
            key = disease.strip().lower()

            # ---------- DGIM ----------
            self.clock += 1
            self.recent.add(key)
            if key not in self.dgim:
                self.dgim[key] = DGIM(DGIM_WINDOW)
            self.dgim[key].add_one(self.clock)

            d = self.dgim[key]
            estimate = d.estimate(self.clock)
            tail = [1 if x == key else 0 for x in self.recent.items]

            dgim = {
                "window_size": DGIM_WINDOW,
                "stream_length": self.clock,
                "disease": disease,
                "binary_stream_tail": tail,
                "estimated_cases": estimate,
                "exact_cases_in_window": sum(tail),
                "status": ("CASE SPIKE DETECTED"
                           if estimate >= DGIM_SPIKE_THRESHOLD else "NORMAL"),
                "spike_threshold": DGIM_SPIKE_THRESHOLD,
                "buckets": [{"timestamp": b[0], "size": b[1]} for b in d.buckets]
            }

            # ---------- Flajolet-Martin ----------
            fm = self._fm_add(locality)

            return dgim, fm

    def watch(self, disease):
        """Current DGIM view for ONE disease (used by the live dashboard)."""
        with self.lock:
            key = disease.strip().lower()
            d = self.dgim.get(key)
            estimate = d.estimate(self.clock) if d else 0
            tail = [1 if x == key else 0 for x in self.recent.items]
            return {
                "disease": disease,
                "clock": self.clock,
                "window_size": DGIM_WINDOW,
                "estimated_cases": estimate,
                "exact_cases_in_window": sum(tail),
                "binary_stream_tail": tail,
                "buckets": [{"timestamp": b[0], "size": b[1]} for b in (d.buckets if d else [])],
                "status": ("CASE SPIKE DETECTED"
                           if estimate >= DGIM_SPIKE_THRESHOLD else "NORMAL"),
                "spike_threshold": DGIM_SPIKE_THRESHOLD
            }

    def fm_snapshot(self):
        with self.lock:
            return self._fm_add("")

    def _fm_add(self, locality):
        locality = locality.strip()
        if locality:
            self.fm.add(locality)
            self.locality_events += 1
            self.exact_localities.add(locality)

        estimate = self.fm.estimate()
        exact = len(self.exact_localities)
        error = abs(estimate - exact)

        example = []
        if locality:
            h0 = self.fm.hashes(locality)[0]
            tz = 32 if h0 == 0 else (h0 & -h0).bit_length() - 1
            example = [{
                "locality": locality,
                "hash_prefix": f"{h0:08x}",
                "rho": tz + 1
            }]

        return {
            "stream_length": self.locality_events,
            "exact_distinct_localities": exact,
            "estimated_distinct_localities": estimate,
            "max_rho": max(self.fm.max_tz) + 1,
            "registers": list(self.fm.max_tz),
            "phi": FM_CORRECTION,
            "absolute_error": error,
            "percentage_error": round(error / exact * 100, 2) if exact else 0,
            "hash_examples": example
        }

    def replay(self, events):
        with self.lock:
            self.clear()
            for e in events:
                self.process(str(e.get("disease", "")), str(e.get("locality", "")))


stream_state = StreamState()


def rebuild_stream_state():
    """After a Flask restart, rebuild the compact state once from stored events."""
    events = list(
        db.stream_events.find({}, {"_id": 0, "disease": 1, "locality": 1})
        .sort("event_number", 1)
    )
    stream_state.replay(events)
    return len(events)


try:
    rebuild_stream_state()
except Exception as error:                      # MongoDB not running yet
    print("Stream state not restored:", error)


@app.route("/api/stream/analyze", methods=["POST"])
def analyze_stream_event():
    """Accept ONE simulated event and update all three algorithms."""
    payload = request.get_json(silent=True) or {}

    disease = str(payload.get("disease", "")).strip()
    patient_id = str(payload.get("patient_id", "")).strip()
    locality = str(payload.get("locality", "")).strip()

    if not disease or not patient_id or not locality:
        return jsonify({
            "error": "Disease, Patient ID and Locality are required."
        }), 400

    last_event = db.stream_events.find_one(
        {}, {"event_number": 1}, sort=[("event_number", -1)]
    )
    event_number = (last_event.get("event_number", 0) if last_event else 0) + 1

    event = {
        "event_number": event_number,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "disease": disease,
        "patient_id": patient_id,
        "locality": locality
    }

    db.stream_events.insert_one(event.copy())

    bloom = bloom_check(disease)
    dgim, fm = stream_state.process(disease, locality)

    analysis = {"event": event, "bloom": bloom, "dgim": dgim, "fm": fm}

    # Audit trail only. Does not touch the historical result collections.
    db.stream_analysis_results.insert_one({
        "event_number": event_number,
        "timestamp": event["timestamp"],
        "disease": disease,
        "patient_id": patient_id,
        "locality": locality,
        "bloom": bloom,
        "dgim": dgim,
        "fm": fm
    })

    return jsonify(analysis)


@app.route("/api/stream/events", methods=["GET"])
def stream_events():
    events = list(
        db.stream_events.find({}, {"_id": 0}).sort("event_number", -1).limit(50)
    )
    return jsonify(events)


@app.route("/api/stream/results", methods=["GET"])
def stream_analysis_results():
    """Return recent interactive algorithm executions for optional UI use."""
    data = list(
        db.stream_analysis_results.find({}, {"_id": 0})
        .sort("event_number", -1).limit(50)
    )
    return jsonify(data)


# ---------------------------------------------------------
# HIGH-VOLUME STREAM (events are processed, NOT stored)
# ---------------------------------------------------------
last_volume_run = {}


@app.route("/api/stream/volume/run", methods=["POST"])
def run_volume():
    payload = request.get_json(silent=True) or {}
    try:
        events = max(1000, min(int(payload.get("events", 200000)), 2000000))
        window = max(10, min(int(payload.get("window", 100000)), 1000000))
    except (TypeError, ValueError):
        return jsonify({"error": "events and window must be numbers."}), 400

    result = run_volume_stream(
        events=events,
        window=window,
        validate=bool(payload.get("validate", True))
    )
    result["finished_at"] = datetime.now(timezone.utc).isoformat()

    # Only the SUMMARY is stored, never the individual events.
    db.stream_volume_runs.insert_one(result.copy())
    last_volume_run.clear()
    last_volume_run.update(result)
    return jsonify(result)


@app.route("/api/stream/volume/last", methods=["GET"])
def last_volume():
    return jsonify(last_volume_run or {})


# ---------------------------------------------------------
# LIVE STREAM: simulated events OR replay of the MIMIC-IV admissions
# ---------------------------------------------------------
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

# Reportable (notifiable-type) conditions, matched against ICD diagnosis titles.
REPORTABLE_PATTERN = re.compile(
    r"tubercul|viral hepatitis|hepatitis [abc]\b|human immunodeficiency|syphilis|salmonell|"
    r"typhoid|malaria|measles|cholera|dengue|meningococc|pertussis|legionell|mumps|rubella",
    re.I)

ICD9_CHAPTERS = [
    (1, 139, "Infectious & parasitic"), (140, 239, "Neoplasms"),
    (240, 279, "Endocrine, nutritional, metabolic"), (280, 289, "Blood diseases"),
    (290, 319, "Mental disorders"), (320, 389, "Nervous system & sense organs"),
    (390, 459, "Circulatory system"), (460, 519, "Respiratory system"),
    (520, 579, "Digestive system"), (580, 629, "Genitourinary system"),
    (630, 679, "Pregnancy & childbirth"), (680, 709, "Skin"),
    (710, 739, "Musculoskeletal"), (740, 759, "Congenital"), (760, 779, "Perinatal"),
    (780, 799, "Symptoms & ill-defined"), (800, 999, "Injury & poisoning")]

ICD10_CHAPTERS = {
    "A": "Infectious & parasitic", "B": "Infectious & parasitic", "C": "Neoplasms",
    "D": "Neoplasms", "E": "Endocrine, nutritional, metabolic", "F": "Mental disorders",
    "G": "Nervous system & sense organs", "H": "Nervous system & sense organs",
    "I": "Circulatory system", "J": "Respiratory system", "K": "Digestive system",
    "L": "Skin", "M": "Musculoskeletal", "N": "Genitourinary system",
    "O": "Pregnancy & childbirth", "P": "Perinatal", "Q": "Congenital",
    "R": "Symptoms & ill-defined", "S": "Injury & poisoning", "T": "Injury & poisoning"}


def icd_chapter(code, version):
    """Map an ICD-9 / ICD-10 code to its broad diagnosis group (chapter)."""
    code = str(code).strip().upper()
    if not code:
        return "Other"
    if str(version) == "9":
        if code[0] in "EV":
            return "Health status & external causes"
        match = re.match(r"\d+", code)
        if match:
            number = int(match.group(0)[:3])
            for low, high, name in ICD9_CHAPTERS:
                if low <= number <= high:
                    return name
        return "Other"
    return ICD10_CHAPTERS.get(code[0], "Health status & external causes")


mimic_cache = {}


def load_mimic():
    """Read the 275 MIMIC-IV Demo admissions once, ordered by admission time."""
    if mimic_cache:
        return mimic_cache

    with open(os.path.join(DATA_DIR, "healthpulse_master.tsv"), encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f, delimiter="\t"))

    records = [{
        "admittime": r["admittime"],
        "subject_id": r["subject_id"],
        "title": r["long_title"],
        "category": icd_chapter(r["icd_code"], r["icd_version"]),
        "source": r.get("admission_location") or "Unknown"
    } for r in rows]
    records.sort(key=lambda r: r["admittime"])

    # Bloom filter over every reportable diagnosis title in the ICD dictionary.
    bloom = BloomFilter(12000, 7)
    reportable_titles = 0
    with open(os.path.join(DATA_DIR, "hosp", "d_icd_diagnoses.csv"), encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            if REPORTABLE_PATTERN.search(r["long_title"]):
                bloom.add(r["long_title"])
                reportable_titles += 1

    mimic_cache.update({
        "records": records,
        "bloom": bloom,
        "reportable_titles": reportable_titles,
        "categories": sorted({r["category"] for r in records})
    })
    return mimic_cache


# ---------------------------------------------------------
LIVE_NOTIFIABLE = ["Dengue", "Malaria", "Typhoid", "Cholera", "Measles", "Tuberculosis"]
LIVE_OTHER = ["Hypertension", "Diabetes", "Pneumonia", "Asthma", "Fracture",
              "Appendicitis", "Gastroenteritis", "Migraine", "Anaemia",
              "Urinary tract infection"]
LIVE_LOCALITIES = ["Andheri", "Bandra", "Borivali", "Dadar", "Kurla", "Thane",
                   "Colaba", "Ghatkopar", "Powai", "Vashi", "Malad", "Chembur"]
MIMIC_DEFAULT_WATCH = "Circulatory system"

live = {
    "running": False, "finished": False, "source": "simulated", "loop": False,
    "rate": 5, "watch": "Dengue", "watch_options": list(LIVE_NOTIFIABLE),
    "seq": 0, "run_events": 0, "total": 0, "flagged": 0, "spikes": 0, "patients": 0,
    "log": deque(maxlen=300), "stop": None,
    "burst_left": 0, "burst_disease": None
}
live_lock = threading.Lock()


def live_next_disease(rng):
    """Mostly routine cases; now and then an outbreak makes one disease dominate."""
    if live["burst_left"] > 0:
        live["burst_left"] -= 1
        if rng.random() < 0.75:
            return live["burst_disease"]
        return rng.choice(LIVE_OTHER + LIVE_NOTIFIABLE)
    if rng.random() < 0.02:
        live["burst_disease"] = rng.choice(LIVE_NOTIFIABLE)
        live["burst_left"] = rng.randint(12, 25)
    return rng.choice(LIVE_NOTIFIABLE) if rng.random() < 0.15 else rng.choice(LIVE_OTHER)


def live_push(entry):
    with live_lock:
        live["seq"] += 1
        live["run_events"] += 1
        if entry["bloom_flag"]:
            live["flagged"] += 1
        if "SPIKE" in str(entry.get("status", "")).upper():
            live["spikes"] += 1
        entry["seq"] = live["seq"]
        live["log"].append(entry)


def live_loop(stop_event):
    """Simulated source."""
    rng = random.Random()
    while not stop_event.is_set():
        disease = live_next_disease(rng)
        locality = rng.choice(LIVE_LOCALITIES)
        live["patients"] += 1
        bloom = bloom_check(disease)
        dgim, fm = stream_state.process(disease, locality)      # ONE update per event
        live_push({
            "time": datetime.now().strftime("%H:%M:%S"),
            "patient_id": f"P{live['patients']:04d}",
            "disease": disease, "detail": "", "locality": locality,
            "bloom_flag": bloom["possibly_notifiable"],
            "dgim_estimate": dgim["estimated_cases"],
            "dgim_exact": dgim["exact_cases_in_window"],
            "status": dgim["status"]
        })
        stop_event.wait(1.0 / max(1, live["rate"]))


def mimic_loop(stop_event):
    """Replay of the real MIMIC-IV admissions, one admission at a time, in time order."""
    data = load_mimic()
    records, bloom = data["records"], data["bloom"]
    index = 0
    while not stop_event.is_set():
        if index >= len(records):
            if live["loop"]:
                index = 0
            else:
                with live_lock:
                    live["running"] = False
                    live["finished"] = True
                return
        rec = records[index]
        index += 1

        # Bloom: is this diagnosis title on the reportable-condition list?
        flagged = bloom.might_contain(rec["title"])
        # DGIM watches the diagnosis group; Flajolet-Martin counts distinct patients.
        dgim, fm = stream_state.process(rec["category"], rec["subject_id"])
        live_push({
            "time": rec["admittime"][:10],
            "patient_id": rec["subject_id"],
            "disease": rec["category"], "detail": rec["title"],
            "locality": rec["source"],
            "bloom_flag": flagged,
            "dgim_estimate": dgim["estimated_cases"],
            "dgim_exact": dgim["exact_cases_in_window"],
            "status": dgim["status"]
        })
        stop_event.wait(1.0 / max(1, live["rate"]))


@app.route("/api/stream/live/sources", methods=["GET"])
def live_sources():
    info = {"simulated": {"label": "Simulated hospital events",
                          "watch_options": LIVE_NOTIFIABLE,
                          "default_watch": "Dengue", "events": None}}
    try:
        data = load_mimic()
        info["mimic"] = {"label": "MIMIC-IV Demo replay (real admissions)",
                         "watch_options": data["categories"],
                         "default_watch": MIMIC_DEFAULT_WATCH,
                         "events": len(data["records"]),
                         "reportable_titles": data["reportable_titles"]}
    except (OSError, KeyError) as error:
        info["mimic_error"] = f"MIMIC files not found: {error}"
    return jsonify(info)


@app.route("/api/stream/live/start", methods=["POST"])
def live_start():
    payload = request.get_json(silent=True) or {}
    try:
        rate = max(1, min(int(payload.get("rate", 5)), 50))
    except (TypeError, ValueError):
        return jsonify({"error": "rate must be a number."}), 400

    source = "mimic" if payload.get("source") == "mimic" else "simulated"
    if source == "mimic":
        try:
            data = load_mimic()
        except (OSError, KeyError) as error:
            return jsonify({"error": f"Cannot read MIMIC files in {DATA_DIR}: {error}"}), 400
        options, default = data["categories"], MIMIC_DEFAULT_WATCH
        target, total = mimic_loop, len(data["records"])
    else:
        options, default = LIVE_NOTIFIABLE, "Dengue"
        target, total = live_loop, 0

    watch = str(payload.get("watch", default))
    if watch not in options:
        watch = default if default in options else options[0]

    with live_lock:
        if live["running"]:
            live["rate"] = rate
            return jsonify({"running": True, "rate": rate, "watch": live["watch"],
                            "source": live["source"]})
        live.update({
            "running": True, "finished": False, "source": source,
            "loop": bool(payload.get("loop", False)), "rate": rate, "watch": watch,
            "watch_options": list(options), "run_events": 0, "total": total,
            "flagged": 0, "spikes": 0, "patients": 0, "stop": threading.Event()
        })
        live["log"].clear()
    stream_state.clear()                      # every run starts from an empty stream
    threading.Thread(target=target, args=(live["stop"],), daemon=True).start()
    return jsonify({"running": True, "rate": rate, "watch": watch, "source": source})


@app.route("/api/stream/live/stop", methods=["POST"])
def live_stop():
    with live_lock:
        if live["stop"]:
            live["stop"].set()
        live["running"] = False
    return jsonify({"running": False})


@app.route("/api/stream/live/state", methods=["GET"])
def live_state():
    try:
        since = int(request.args.get("since", 0))
    except ValueError:
        since = 0
    with live_lock:
        watch = request.args.get("watch") or live["watch"]
        if watch not in live["watch_options"]:
            watch = live["watch"]
        events = [e for e in live["log"] if e["seq"] > since]
        snapshot = {k: live[k] for k in ("running", "finished", "source", "rate", "seq",
                                         "run_events", "total", "flagged", "spikes")}
    return jsonify({
        **snapshot,
        "processed": snapshot["run_events"],
        "events": events[-40:],
        "distinct_diseases": len(stream_state.dgim),
        "watched": stream_state.watch(watch),
        "fm": stream_state.fm_snapshot(),
        "fm_label": "distinct patients" if snapshot["source"] == "mimic" else "distinct localities",
        "events_stored_in_database": 0
    })


@app.route("/api/stream/reset", methods=["POST"])
def reset_stream_events():
    events_result = db.stream_events.delete_many({})
    analysis_result = db.stream_analysis_results.delete_many({})
    stream_state.clear()
    with live_lock:
        live["log"].clear()
        live["flagged"] = 0
        live["run_events"] = 0
    return jsonify({
        "deleted": events_result.deleted_count,
        "analysis_deleted": analysis_result.deleted_count
    })


# ---------------------------------------------------------
# BED CAPACITY DATA
# CDPH licensed healthcare facility capacity dataset
# ---------------------------------------------------------

def get_capacity_filters():
    """Build filters for date, level, facility type, and metric."""
    period = request.args.get("period")
    level = request.args.get("level", "all")
    metric = request.args.get("metric")
    facility_type = request.args.get("facility_type")
    region = request.args.get("region")

    filters = {}

    if not period:
        latest = db.bed_capacity_new.find_one(
            {},
            {"_id": 0, "period": 1},
            sort=[("period", -1)]
        )
        if latest:
            period = latest.get("period")

    if period:
        filters["period"] = period

    if level and level.lower() != "all":
        filters["level"] = level

    if metric and metric.lower() != "all":
        filters["metric"] = metric

    if facility_type and facility_type.lower() != "all":
        filters["facility_type"] = facility_type

    if region and region.lower() != "all":
        filters["region"] = region

    return filters


@app.route("/api/bed-capacity")
def bed_capacity():
    filters = get_capacity_filters()

    data = list(
        db.bed_capacity_new.find(
            filters,
            {"_id": 0}
        ).sort([
            ("facility_type", 1),
            ("metric", 1),
            ("bed_type", 1),
            ("org_name", 1)
        ]).limit(5000)
    )

    return jsonify({
        "filters": filters,
        "count": len(data),
        "data": data
    })


@app.route("/api/bed-capacity/summary")
def bed_capacity_summary():
    filters = get_capacity_filters()

    pipeline = [
        {"$match": filters},
        {
            "$group": {
                "_id": {
                    "metric": "$metric",
                    "bed_type": "$bed_type"
                },
                "total_value": {"$sum": "$value"},
                "record_count": {"$sum": 1}
            }
        },
        {
            "$project": {
                "_id": 0,
                "metric": "$_id.metric",
                "bed_type": "$_id.bed_type",
                "total_value": 1,
                "record_count": 1
            }
        },
        {"$sort": {"metric": 1, "bed_type": 1}}
    ]

    data = list(db.bed_capacity_new.aggregate(pipeline))

    return jsonify({
        "filters": filters,
        "count": len(data),
        "data": data
    })


@app.route("/api/bed-capacity/metrics")
def bed_capacity_metrics():
    metrics = db.bed_capacity_new.distinct("metric")
    return jsonify(metrics)


@app.route("/api/bed-capacity/facility-types")
def bed_capacity_facility_types():
    facility_types = db.bed_capacity_new.distinct("facility_type")
    facility_types = sorted([x for x in facility_types if x])
    return jsonify(facility_types)


@app.route("/api/bed-capacity/regions")
def bed_capacity_regions():
    regions = db.bed_capacity_new.distinct("region")
    regions = sorted([x for x in regions if x])
    return jsonify(regions)


# ---------------------------------------------------------
# RUN APPLICATION
# ---------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True)