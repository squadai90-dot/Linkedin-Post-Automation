#!/usr/bin/env python3
"""Print the Unison data store as one line per record.

A listing of the store is mostly base64, which is unreadable and enormous.
This keeps the fields that say what state a post is in and reports the media
as a size, which is the only thing about it anyone needs to know.
"""
import json, sys, glob, os, time

path = sys.argv[1] if len(sys.argv) > 1 else max(
    glob.glob(os.path.expanduser("~/.claude/projects/*/*/tool-results/mcp-Make-data-store-records_list-*.txt")),
    key=os.path.getmtime)
d = json.load(open(path))
recs = d["records"] if isinstance(d, dict) and "records" in d else d
now = int(time.time())
print(f"{len(recs)} record(s)  ·  now={now}  ·  {os.path.basename(path)}")
total = 0
for r in recs:
    a = r.get("data", {})
    media = a.get("media") or []
    mb = sum(len(str(m.get("data") or "")) for m in media)
    total += mb
    due = a.get("dueAt")
    when = ("due " + ("PAST" if due and int(due) <= now else "future") + f" {due}") if due else "no dueAt"
    print(f"  {r.get('key'):<24} {str(a.get('postType')):<9} {str(a.get('status')):<12} {when:<24} "
          f"media={len(media)}/{mb}B  urn={a.get('publishedUrn') or '-'}")
    if a.get("note"):
        print(f"      note: {str(a['note'])[:150]}")
print(f"  media total {total} B of 1048576 B ({100*total/1048576:.0f}% of the store)")
