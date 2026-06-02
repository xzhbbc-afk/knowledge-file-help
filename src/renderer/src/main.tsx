import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles.css";

import { MantineProvider, createTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const theme = createTheme({
  primaryColor: "teal",
  fontFamily: '"Microsoft YaHei", "Segoe UI", Arial, sans-serif',
  defaultRadius: "sm"
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MantineProvider theme={theme}>
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </StrictMode>
);
