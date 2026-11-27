import { useLayoutEffect, useState } from 'react';

/** Keep floating operation controls above commit forms and conflict save buttons. */
export function useGitOperationNoticePlacement() {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!root) return;
    let frame = 0; const observed = new Set<Element>();
    const resize = new ResizeObserver(() => schedule());
    function update() {
      frame = 0; if (!root) return;
      const bounds = root.getBoundingClientRect();
      const protectedRegions = [...root.querySelectorAll<HTMLElement>('.project-git-commit-rail, .project-git-commit-collapsed, .git-conflict-footer')];
      const notice = root.querySelector<HTMLElement>('.git-operation-notice');
      const current = new Set<Element>([root, ...protectedRegions, ...(notice ? [notice] : [])]);
      for (const element of observed) if (!current.has(element)) { resize.unobserve(element); observed.delete(element); }
      for (const element of current) if (!observed.has(element)) { resize.observe(element); observed.add(element); }
      let bottom = 12;
      for (const region of protectedRegions) { const rect = region.getBoundingClientRect(); if (rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom) bottom = Math.max(bottom, bounds.bottom - rect.top + 8); }
      bottom = Math.round(Math.min(bottom, Math.max(12, bounds.height - (notice?.getBoundingClientRect().height ?? 0) - 8)));
      root.style.setProperty('--git-operation-notice-bottom', `${bottom}px`);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    const mutations = new MutationObserver(schedule); mutations.observe(root, { childList: true, subtree: true });
    root.addEventListener('scroll', schedule, true); update();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); root.removeEventListener('scroll', schedule, true); root.style.removeProperty('--git-operation-notice-bottom'); };
  }, [root]);
  return setRoot;
}
