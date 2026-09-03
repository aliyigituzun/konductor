import { createContext } from "react";

export interface AppContextValue {
  projectName: string | null;
  setProjectName: (name: string | null) => void;
}

export const AppContext = createContext<AppContextValue>({
  projectName: null,
  setProjectName: () => {},
});
