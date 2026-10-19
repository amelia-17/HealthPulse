"""
HealthPulse - historical analytics with Python/Pandas (replaces Hadoop MapReduce).

Reads the SAME prepared files the MapReduce jobs used, so results are identical:
  data/healthpulse_disease_hadoop.tsv -> disease_counts      {disease, count}
  data/healthpulse_master.tsv         -> los_by_admission    {admission_type, average_los}
                                      -> icu_los_by_unit     {first_careunit, ...} (optional extra)

Usage:
  python build_historical_data.py            # compute, compare with old Hadoop output, write to MongoDB
  python build_historical_data.py --no-db    # compute and compare only (no MongoDB needed)
"""
import sys
from pathlib import Path
import pandas as pd

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
WRITE_DB = "--no-db" not in sys.argv

# ---------- 1. Disease counts (was MapReduce job 1) ----------
dis = pd.read_csv(DATA / "healthpulse_disease_hadoop.tsv", sep="\t", dtype=str)
dis["long_title"] = dis["long_title"].str.strip()
disease_counts = (
    dis[dis["long_title"].notna() & (dis["long_title"] != "")]
    .groupby("long_title").size()
    .reset_index(name="count")
    .rename(columns={"long_title": "disease"})
    .sort_values(["count", "disease"], ascending=[False, True])
    .reset_index(drop=True)
)

# ---------- 2. Hospital LOS by admission type (was MapReduce job 2) ----------
master = pd.read_csv(DATA / "healthpulse_master.tsv", sep="\t")
los = (
    master.dropna(subset=["admission_type", "length_of_stay_days"])
    .groupby("admission_type")["length_of_stay_days"].mean()
    .reset_index(name="average_los")
)

# ---------- 3. ICU LOS by care unit (was MapReduce job 3, optional) ----------
icu = (
    master.dropna(subset=["first_careunit", "total_icu_length_of_stay_days"])
    .groupby("first_careunit")
    .agg(admissions=("hadm_id", "size"),
         unique_patients=("subject_id", "nunique"),
         average_icu_los=("total_icu_length_of_stay_days", "mean"))
    .reset_index()
)

# ---------- 4. Validate against the previous Hadoop output ----------
old_dis = pd.read_csv(DATA / "disease_counts.tsv", sep="\t", header=None,
                      names=["disease", "count"])
old_los = pd.read_csv(DATA / "los_by_admission.tsv", sep="\t", header=None,
                      names=["admission_type", "average_los"])

dis_ok = (disease_counts.set_index("disease")["count"]
          .sort_index().equals(old_dis.set_index("disease")["count"].sort_index()))
m = los.merge(old_los, on="admission_type", suffixes=("", "_old"))
los_ok = len(m) == len(los) == len(old_los) and ((m.average_los - m.average_los_old).abs() < 1e-6).all()

print(f"disease_counts  : {len(disease_counts)} rows | matches old Hadoop output: {dis_ok}")
print(f"los_by_admission: {len(los)} rows | matches old Hadoop output: {los_ok}")
print(f"icu_los_by_unit : {len(icu)} rows")

# ---------- 5. Write to MongoDB (same collections the Flask API already reads) ----------
if WRITE_DB:
    from pymongo import MongoClient
    db = MongoClient("mongodb://localhost:27017/")["healthpulse"]
    for name, df in [("disease_counts", disease_counts),
                     ("los_by_admission", los),
                     ("icu_los_by_unit", icu)]:
        db[name].delete_many({})
        db[name].insert_many(df.to_dict("records"))
    print("MongoDB updated: disease_counts, los_by_admission, icu_los_by_unit")
else:
    print("--no-db: MongoDB not touched")