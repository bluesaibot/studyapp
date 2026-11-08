# StudyApp

Personal macOS study app with a plant game. Runs locally; all data lives in
`~/Library/Application Support/StudyApp/`.

The UI is English. All exam content (questions, cards, answers, AI feedback) is German.

```
npm install
npm run dev     # development
npm test        # logic tests
npm run app     # builds dist/mac-arm64/StudyApp.app
npm run shots   # screenshots of every screen, using throwaway data
npm run flow -- <output-folder> <lernskript-folder>...   # drives the study features on throwaway data
```

All reward values are in `src/core/rewards.ts` and `src/core/streak.ts`.
