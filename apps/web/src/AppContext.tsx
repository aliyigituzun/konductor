import { createContext } from "react";

export interface AppContextValue {
  projectName: string | null;
  setProjectName: (name: string | null) => void;
  projectProfileName: string;
  setProjectProfileName: (name: string) => void;
  /** The active Project Space; users, authentication, and remote access are scoped to it. */
  projectProfileId: string;
  setProjectProfileId: (id: string) => void;
}

export const AppContext = createContext<AppContextValue>({
  projectName: null,
  setProjectName: () => {},
  projectProfileName: "Personal",
  setProjectProfileName: () => {},
  projectProfileId: "personal",
  setProjectProfileId: () => {},
});
