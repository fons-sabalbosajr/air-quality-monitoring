import { createContext, useContext, useMemo, useState } from "react";

const AqiContext = createContext({ category: null, setCategory: () => {} });

export function AqiProvider({ children }) {
  const [category, setCategory] = useState(null);
  const value = useMemo(() => ({ category, setCategory }), [category]);
  return <AqiContext.Provider value={value}>{children}</AqiContext.Provider>;
}

export function useAqi() {
  return useContext(AqiContext);
}

export default AqiContext;
