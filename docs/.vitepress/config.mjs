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
          { text: "Server Setup", link: "/server/01-server-setup" },
          { text: "Database Setup", link: "/server/02-database-setup" },
          { text: "Database Migrations", link: "/server/03-database-migrations" },
          { text: "SQL Queries with Squirrel", link: "/server/04-sql-queries" },
          { text: "Connecting to the Database", link: "/server/05-database-connection" },
          { text: "Task Repository", link: "/server/06-task-repository" },
          { text: "API Routes", link: "/server/07-api-routes" },
          { text: "Integration Tests", link: "/server/08-integration-tests" },
          { text: "Server Dockerfile", link: "/server/09-server-dockerfile" },
        ],
      },
      {
        text: "Client",
        items: [
          { text: "Client Setup", link: "/client/01-client-setup" },
          { text: "Tasks Screen", link: "/client/02-tasks-screen" },
          { text: "Client-Side Routing", link: "/client/03-client-routing" },
          { text: "New Task Page", link: "/client/04-new-task-page" },
          { text: "Edit Task Page", link: "/client/05-edit-task-page" },
          { text: "Vite Build Tool", link: "/client/06-vite-build-tool" },
          { text: "Styling", link: "/client/07-styling" },
        ],
      },
    ],
  },
};
