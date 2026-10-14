import { useEffect, useRef } from 'react';

interface NativeCloseLayerEntry {
  id: symbol;
  close: () => void;
}

const closeLayers: NativeCloseLayerEntry[] = [];
let initialized = false;

/** Cmd+W 先关闭当前最上层弹窗，不穿透到应用窗口。 */
export function initializeNativeCloseLayerRouting(): void {
  if (initialized) return;
  initialized = true;
  window.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'w' || closeLayers.length === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeLayers.at(-1)?.close();
  }, true);
}

/** 组件卸载或关闭时同步移除注册。 */
export function useNativeCloseLayer(active: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!active) return;
    initializeNativeCloseLayerRouting();
    const entry: NativeCloseLayerEntry = {
      id: Symbol('zeus-native-close-layer'),
      close: () => closeRef.current(),
    };
    closeLayers.push(entry);
    return () => {
      const index = closeLayers.findIndex((candidate) => candidate.id === entry.id);
      if (index >= 0) closeLayers.splice(index, 1);
    };
  }, [active]);
}
