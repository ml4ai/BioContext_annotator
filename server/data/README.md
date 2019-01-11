Data Folders
============

- `dictionaries`: Baseline context dictionaries, preloaded to help with assigning the correct grounding IDs to new contexts created manually using the annotation tool.

- `papers`: Baseline Reach output and manual annotations (where applicable) for the articles.

Temporary folders
-----------------

- `new_dictionaries`: Contains the new set of dictionaries (Cellosaurus, Uberon, etc.) to be used in the future; will become the main set after it has been properly processed/deconflicted.

- `old_papers`: Papers from the previous version of Reach (before Aug 2016); the main change appears to be in the delimiter used in `mention_intervals.txt`.
