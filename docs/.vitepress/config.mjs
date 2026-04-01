import footnote from "markdown-it-footnote";

export default {
  title: "Gleam Guide",
  description: "A practical guide to building full-stack apps with Gleam",
  markdown: {
    theme: {
      light: "vitesse-light",
      dark: "vitesse-dark",
    },
    config: (md) => {
      md.use(footnote);
    },
  },
  themeConfig: {
    sidebar: [
      {
        items: [
          { text: "Introduction", link: "/" },
          { text: "Getting Started", link: "/getting-started" },
          { text: "Setting Up the Server", link: "/server-setup" },
          { text: "Setting Up the Database", link: "/database-setup" },
        ],
      },
    ],
  },
};
