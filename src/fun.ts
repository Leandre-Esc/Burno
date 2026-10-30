// A bit of personality: the odd "burne" joke, never on every message.

const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

/** Returns a joke some of the time, a plain line otherwise. */
const sometimes = (jokes: string[], plain: string[], odds = 0.35) => pick(Math.random() < odds ? jokes : plain);

export const fun = {
  tagline: "API client à fond les burnes",

  sending: () =>
    sometimes(["À fond les burnes…", "On envoie la purée…", "Ça chauffe sous le capot…"], ["Sending request…", "Waiting for the server…"]),

  idle: () =>
    sometimes(
      ["Envoie la sauce, on verra si ça tient.", "Rien encore. Pas de quoi se gratter les burnes."],
      ["Send the request to see the response here.", "The response will show up here."],
    ),

  noRequest: () =>
    sometimes(
      ["Rien dans les burnes pour l'instant.", "Une requête, et que ça saute."],
      ["Pick a request in the sidebar, or create a new one.", "Nothing open yet."],
    ),

  emptyCollection: () => sometimes(["Pas une burne là-dedans."], ["Empty — add a request with +"]),

  status: (status: number) => {
    if (status < 300) return sometimes(["Solide comme une paire de burnes.", "Nickel, burnes au chaud."], ["Success", "All good"]);
    if (status < 400) return sometimes(["On te renvoie voir ailleurs."], ["Redirect"]);
    if (status < 500) return sometimes(["Ça casse les burnes, hein ?", "Le serveur te les brise menu."], ["Client error", "Check your request"]);
    return sometimes(["Le serveur a les burnes en vrac.", "Coup bas côté backend."], ["Server error", "Something broke on the server"]);
  },

  networkError: () =>
    sometimes(["Le serveur s'est fait la malle.", "Personne au bout du fil. Burnes à l'air."], ["Request failed", "Could not reach the server"]),
};
