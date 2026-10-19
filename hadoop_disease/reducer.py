import sys

current_disease = None
current_count = 0

for line in sys.stdin:
    line = line.rstrip("\n")

    parts = line.split("\t", 1)

    if len(parts) != 2:
        continue

    disease = parts[0]
    count = int(parts[1])

    if current_disease == disease:
        current_count += count
    else:
        if current_disease is not None:
            print(f"{current_disease}\t{current_count}")

        current_disease = disease
        current_count = count

if current_disease is not None:
    print(f"{current_disease}\t{current_count}")
