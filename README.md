# StudyApp

Personal macOS study app with a plant game. Runs locally; all data lives in
`~/Library/Application Support/StudyApp/`.

Every launch keeps a copy of that data in its `backups/` folder (the newest 30). Tests and the
flow script only ever use a throwaway data folder.

The UI is English. All exam content (questions, cards, answers, AI feedback) is German.

```
npm install
npm run dev     # development
npm test        # logic tests
npm run app     # builds dist/mac-arm64/StudyApp.app
npm run release # builds the installer, dist/StudyApp-<version>-arm64.dmg
npm run shots   # screenshots of every screen, using throwaway data
npm run flow -- <output-folder> ~/Desktop/uni/biochemische_-bungen_seminar   # drives the study features on throwaway data
```

All reward values are in `src/core/rewards.ts` and `src/core/streak.ts`.
