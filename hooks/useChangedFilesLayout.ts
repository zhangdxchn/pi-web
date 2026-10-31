"use client";

import { useCallback, useEffect, useState } from "react";
import { loadChangedFilesLayout, saveChangedFilesLayout, type ChangedFilesLayout, type ChangedFilesSurface } from "@/lib/changed-files-layout";

/** Each surface owns its choice; restore after hydration like the sidebar prefs. */
export function useChangedFilesLayout(surface: ChangedFilesSurface) {
  const [layout, setLayout] = useState<ChangedFilesLayout>("list");
  useEffect(() => { setLayout(loadChangedFilesLayout(surface)); }, [surface]);
  const chooseLayout = useCallback((next: ChangedFilesLayout) => {
    setLayout(next);
    saveChangedFilesLayout(surface, next);
  }, [surface]);
  return [layout, chooseLayout] as const;
}
