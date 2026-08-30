export const EBAY_LIFECYCLE_CSS = `
:host { all: initial; color-scheme: light; }
.panel { position: fixed; z-index: 2147483646; right: 16px; bottom: 16px; width: min(340px, calc(100vw - 32px)); border: 1px solid #b8c2cf; border-radius: 8px; background: #fff; box-shadow: 0 8px 24px rgba(15, 23, 42, .2); color: #162033; padding: 12px; font: 13px/1.35 Arial, sans-serif; }
.heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 9px; }
.heading strong { color: #1557d6; font-size: 15px; }
.heading span { color: #526176; text-transform: capitalize; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
button { min-height: 34px; border: 1px solid #1557d6; border-radius: 6px; background: #1557d6; color: #fff; cursor: pointer; font: 700 12px/1.2 Arial, sans-serif; padding: 7px 9px; }
button[data-action="all"] { background: #fff; color: #1557d6; }
button[data-action="resume"] { grid-column: 1 / -1; border-color: #12603a; background: #12603a; }
button[data-action="stop"] { grid-column: 1 / -1; border-color: #a52828; background: #a52828; }
button:focus-visible { outline: 3px solid #f0b429; outline-offset: 2px; }
button:disabled { cursor: wait; opacity: .55; }
p { min-height: 18px; margin: 9px 0 0; color: #46566f; overflow-wrap: anywhere; }
@media (max-width: 420px) { .panel { right: 8px; bottom: 8px; width: calc(100vw - 16px); } }
`;
