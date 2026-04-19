import footnote from "markdown-it-footnote";

export default {
  head: [
    ['style', {}, `
      .dark-only { display: none; }
      .dark .dark-only { display: block; }
      .dark .light-only { display: none; }
      figure { display: flex; flex-direction: column; align-items: center; }
      figure img { border-radius: 8px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12); }
    `],
  ],
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
          {
            text: "Database Migrations",
            link: "/server/03-database-migrations",
          },
          { text: "SQL Queries with Squirrel", link: "/server/04-sql-queries" },
          {
            text: "Connecting to the Database",
            link: "/server/05-database-connection",
          },
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
          {
            text: "Structuring the Client",
            link: "/client/03-structuring-the-client",
          },
          { text: "Create Tasks", link: "/client/04-create-tasks" },
          {
            text: "Edit and Delete Tasks",
            link: "/client/05-edit-and-delete-tasks",
          },
          { text: "Vite Build Tool", link: "/client/06-vite-build-tool" },
          { text: "Styling", link: "/client/07-styling" },
          {
            text: "Production Deployment",
            link: "/client/08-production-deployment",
          },
          { text: "Recap — The Web App", link: "/client/09-web-app-recap" },
          { text: "Desktop Setup", link: "/client/10-desktop-setup" },
          { text: "Desktop Additions", link: "/client/11-desktop-additions" },
          { text: "Native HTTP", link: "/client/12-native-http" },
          { text: "Mobile Setup", link: "/client/13-mobile-setup" },
        ],
      },
    ],
  },
};
