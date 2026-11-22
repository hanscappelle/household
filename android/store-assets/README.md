# Google Play visual assets

- `icon-512.png`: store listing app icon (512 × 512).
- `feature-graphic-1024x500.png`: Google Play feature graphic (1024 × 500).
- `screenshots/`: phone and tablet screenshots, captured from the app's fictional demo data.
  - Root: four 1080 × 2160 phone screenshots.
  - `tablet/landscape/`: four 2560 × 1440 tablet screenshots.
  - `tablet/portrait/`: four 1600 × 2364 tablet screenshots.
- `generate-artwork.swift`: regenerates the icon and feature graphic on macOS; the feature graphic uses the overview screenshot.

The screenshots show real app screens. Tablet screenshots were captured on an Android emulator with fictional demo data. Screenshots are cropped to remove Android status/navigation bars; all image sizes fit Play's screenshot requirements.
