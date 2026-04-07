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
        ],
      },
      {
        text: "Server",
        items: [
          { text: "Server Setup", link: "/server-setup" },
          { text: "Database Setup", link: "/database-setup" },
          { text: "Database Migrations", link: "/database-migrations" },
          { text: "SQL Queries with Squirrel", link: "/sql-queries" },
          { text: "Connecting to the Database", link: "/database-connection" },
          { text: "Task Repository", link: "/task-repository" },
          { text: "API Routes", link: "/api-routes" },
          { text: "Integration Tests", link: "/integration-tests" },
          { text: "Server Dockerfile", link: "/server-dockerfile" },
        ],
      },
      {
        text: "Client",
        items: [
          { text: "Client Setup", link: "/client-setup" },
        ],
      },
    ],
  },
};
