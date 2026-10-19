# PLSEQ Payload Builder

Builds the USR_PLSEQ_TRAN inbound XML for the sequencing chain.

## Run

    npm install
    npm run dev        # local
    npm run build      # production build in dist/
    npm test           # logic tests

## Netlify

Netlify reads `netlify.toml`: build command `npm run build`, publish folder `dist`.
No backend, no environment variables. Everything is saved in the browser (localStorage).

## Where to change things

| What | File |
|---|---|
| Starter models, parts and defaults | `src/App.jsx` (`starterState`) and `src/payload.js` (`DEFAULT_SETTINGS`) |
| Token format and stepping | `src/payload.js` (`fmtToken`, `tokenFor`) |
| XML layout and field order | `src/payload.js` (`toXml`) |
| Checks shown on screen | `src/payload.js` (`validate`) |
| Colors and spacing | `src/styles.css` (variables at the top) |

## Behavior to know

- An empty vehicle token follows the clock. Typing a token pins it.
- Loading a saved version or a pasted XML keeps parts, models and ops sequences. Tokens and the production date are regenerated from the current time when "Tokens always follow real time" is on.
- `UC_INC_PRT_NUM` is numbered 1..n inside each vehicle so every (token, `UC_INC_PRT_NUM`) pair is unique.
- `UC_SEQ_NUM` is one number per vehicle.
- The cart type is not part of the message. It only builds the scan barcode (`S` + cart type + ops seq + serial).
"# xml-form" 
