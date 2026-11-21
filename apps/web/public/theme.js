(() => {
  let theme = null;
  try {
    theme = localStorage.getItem("cota-theme");
  } catch {}
  const dark =
    theme === "dark" ||
    (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
