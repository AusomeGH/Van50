import json

with open("data/events.json", "r", encoding="utf-8") as f:
    events = json.load(f)

quarantined = []
try:
    with open("data/manual_review_queue.json", "r", encoding="utf-8") as f:
        q = json.load(f)
        quarantined = q.get("items", []) if isinstance(q, dict) else (q if isinstance(q, list) else [])
except Exception:
    pass

with open("js/data.js", "w", encoding="utf-8") as f:
    f.write("// Van50 — Vancouver Events & Outings (Strictly <= $50 CAD)\n")
    f.write("// AUTO-GENERATED from central data/events.json\n\n")
    f.write("const VANCOUVER_EVENTS = " + json.dumps(events, indent=2, ensure_ascii=False) + ";\n\n")
    f.write("const MANUAL_REVIEW_QUEUE = " + json.dumps(quarantined, indent=2, ensure_ascii=False) + ";\n\n")
    f.write("""const NEIGHBORHOODS = [
  "Downtown, Gastown & Yaletown",
  "Mount Pleasant & South Vancouver",
  "Commercial Drive & East Vancouver",
  "Kitsilano, Point Grey & UBC",
  "Granville Island & False Creek",
  "North Shore, Burnaby & Metro"
];

const DAYS_OF_WEEK = [
  { id: "all", label: "All Days", icon: "🗓️" },
  { id: "mon", label: "Mon", full: "Monday" },
  { id: "tue", label: "Tue", full: "Tuesday" },
  { id: "wed", label: "Wed", full: "Wednesday" },
  { id: "thu", label: "Thu", full: "Thursday" },
  { id: "fri", label: "Fri", full: "Friday" },
  { id: "sat", label: "Sat", full: "Saturday" },
  { id: "sun", label: "Sun", full: "Sunday" }
];
""")

print("Sync completed successfully.")
