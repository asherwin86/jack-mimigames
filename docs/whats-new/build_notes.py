#!/usr/bin/env python3
"""Regenerates WHATS-NEW.txt from the per-version files in updates/ (newest first).

Each updates/vX.Y.Z.txt is written by hand after an update ships (see the top of
WHATS-NEW.txt for the format). Run:  python3 docs/whats-new/build_notes.py
"""
import glob, os, re

here = os.path.dirname(os.path.abspath(__file__))
files = glob.glob(os.path.join(here, "updates", "v*.txt"))
key = lambda f: tuple(int(n) for n in re.findall(r"\d+", os.path.basename(f)))
files.sort(key=key, reverse=True)

head = """100 MIMI GAMES - WHAT'S BEEN ADDED
==================================

Newest update first. Every update is also in its own file in the "updates"
folder. Each one is released to the website and the Windows app together
(the app updates itself the next time you open it).

"""
body = "\n\n".join(open(f, encoding="utf-8").read().strip() for f in files)
open(os.path.join(here, "WHATS-NEW.txt"), "w", encoding="utf-8").write(head + body + "\n")
print(f"WHATS-NEW.txt rebuilt from {len(files)} update files")
