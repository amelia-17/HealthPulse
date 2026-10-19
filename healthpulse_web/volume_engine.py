"""
HealthPulse - HIGH-VOLUME streaming engine.

Runs a long simulated hospital-event stream through Bloom / DGIM / Flajolet-Martin
WITHOUT storing the events. Only the compact algorithm state is kept in memory.

  Bloom filter   : "has this patient already been reported?"  (duplicate-report check)
  Flajolet-Martin: "how many DISTINCT patients have we seen?"
  DGIM           : "how many cases of disease X in the last W events?"  (outbreak spikes)

With validate=True an exact method (set / deque) runs alongside, ONLY so that the
dashboard can show real error and real memory side by side.
"""
import random
import time
from collections import deque, Counter

from streaming_algos import BigBloom, DGIM, FMSketch, py_size

NOTIFIABLE = ["Dengue", "Malaria", "Typhoid", "Cholera", "Measles", "Tuberculosis"]
OTHER = ["Hypertension", "Diabetes", "Pneumonia", "Asthma", "Fracture", "Appendicitis",
         "Gastroenteritis", "Migraine", "Anaemia", "Urinary tract infection"]
DISEASES = NOTIFIABLE + OTHER
N_LOCALITIES = 400
SPIKE_SHARE = 0.10          # notifiable disease making up >=10% of the window = spike
CHECK_EVERY = 2000


def run_volume_stream(events=200_000, window=100_000, validate=True, seed=None):
    rng = random.Random(seed)
    events = int(events)
    window = int(window)
    validate = bool(validate) and events <= 1_000_000

    bloom = BigBloom(expected_items=events)
    fm = FMSketch(registers=64)
    dgim = {d: DGIM(window) for d in DISEASES}

    # exact side (validation only)
    ex_patients = set() if validate else None
    ex_window = deque(maxlen=window) if validate else None
    ex_counts = Counter() if validate else None

    recent_patients = []            # small ring used to generate duplicate reports
    next_patient = 0
    burst_left, burst_disease = 0, None

    dup_flagged = true_dups = false_pos = false_neg = 0
    alerts, active = [], {}

    t0 = time.perf_counter()
    for t in range(1, events + 1):
        # ---------- generate one event ----------
        if burst_left > 0:
            burst_left -= 1
            disease = burst_disease if rng.random() < 0.5 else rng.choice(DISEASES)
        else:
            if rng.random() < 0.00004:                        # an outbreak begins
                burst_disease = rng.choice(NOTIFIABLE)
                burst_left = rng.randint(10_000, 40_000)
            disease = rng.choice(NOTIFIABLE) if rng.random() < 0.15 else rng.choice(OTHER)

        if recent_patients and rng.random() < 0.08:           # re-reported patient
            pid = recent_patients[rng.randrange(len(recent_patients))]
        else:
            pid = f"P{next_patient:08d}"
            next_patient += 1
            if len(recent_patients) < 5000:
                recent_patients.append(pid)
            else:
                recent_patients[rng.randrange(5000)] = pid

        # ---------- the three algorithms (one update each) ----------
        was_seen = bloom.add_if_new(pid)
        fm.add(pid)
        dgim[disease].add_one(t)

        if was_seen:
            dup_flagged += 1

        if validate:
            truth_seen = pid in ex_patients
            ex_patients.add(pid)
            if truth_seen:
                true_dups += 1
                if not was_seen:
                    false_neg += 1
            elif was_seen:
                false_pos += 1
            if len(ex_window) == window:
                ex_counts[ex_window[0]] -= 1
            ex_window.append(disease)
            ex_counts[disease] += 1

        # ---------- outbreak check ----------
        if t % CHECK_EVERY == 0:
            for d in NOTIFIABLE:
                est = dgim[d].estimate(t)
                spiking = est >= SPIKE_SHARE * min(t, window)
                if spiking and d not in active:
                    active[d] = True
                    alerts.append({"event": t, "disease": d, "estimated_cases": est,
                                   "exact_cases": ex_counts[d] if validate else None})
                elif not spiking:
                    active.pop(d, None)

    seconds = time.perf_counter() - t0

    # ---------- summary ----------
    now = events
    table = []
    for d in DISEASES:
        est = dgim[d].estimate(now)
        table.append({"disease": d, "estimated_cases": est,
                      "exact_cases": ex_counts[d] if validate else None,
                      "buckets": len(dgim[d].buckets)})
    table.sort(key=lambda r: -r["estimated_cases"])

    patients_est = fm.estimate()
    patients_exact = len(ex_patients) if validate else None

    memory = [
        {"task": "Distinct patients (Flajolet-Martin)",
         "algorithm_bytes": py_size(fm.max_tz),
         "exact_bytes": py_size(ex_patients) if validate else None},
        {"task": "Duplicate-report check (Bloom filter)",
         "algorithm_bytes": len(bloom.data),
         "exact_bytes": py_size(ex_patients) if validate else None},
        {"task": f"Recent-window disease counts (DGIM, window {window:,})",
         "algorithm_bytes": sum(py_size(x.buckets) for x in dgim.values()),
         "exact_bytes": py_size(ex_window) if validate else None},
    ]
    for m in memory:
        m["ratio"] = (round(m["exact_bytes"] / m["algorithm_bytes"], 1)
                      if m["exact_bytes"] else None)

    return {
        "events_processed": events,
        "events_stored": 0,
        "seconds": round(seconds, 2),
        "events_per_second": int(events / seconds) if seconds else 0,
        "window": window,
        "validated_against_exact": validate,
        "patients": {
            "estimated_distinct": patients_est,
            "exact_distinct": patients_exact,
            "error_percent": (round(abs(patients_est - patients_exact) / patients_exact * 100, 1)
                              if patients_exact else None),
        },
        "bloom": {
            "bits": bloom.m, "hash_functions": bloom.k,
            "duplicates_flagged": dup_flagged,
            "true_duplicates": true_dups if validate else None,
            "false_positives": false_pos if validate else None,
            "missed_duplicates": false_neg if validate else None,
        },
        "dgim": table[:8],
        "spike_alerts": alerts[:20],
        "memory": memory,
    }


if __name__ == "__main__":
    import json, sys
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 200_000
    print(json.dumps(run_volume_stream(n, seed=1), indent=2))