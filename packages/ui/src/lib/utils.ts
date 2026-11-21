import { createCn } from "cn/config";

/* cn cannot read the Tailwind theme, so it learns the radius names that
   theme.css adds; without them `rounded-card` would not replace `rounded-sm`. */
export const cn = createCn({
  extend: {
    theme: {
      radius: ["block", "control", "panel", "card"],
    },
  },
});
