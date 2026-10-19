import sys

for line in sys.stdin:
    line = line.rstrip("\n")

    # Skip header
    if line.startswith("subject_id"):
        continue

    fields = line.split("\t")

    # long_title is column 6
    if len(fields) >= 6:
        disease = fields[5].strip()

        if disease:
            print(f"{disease}\t1")
