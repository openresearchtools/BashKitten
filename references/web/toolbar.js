// SPDX-License-Identifier: AGPL-3.0-only
// Native popovers escape the scrolling toolbar; only their anchor placement is adapted.
export function createReferenceToolbar({ toolbar, button, menu }) {
  const view = menu.ownerDocument.defaultView;
  const viewport = view.visualViewport;
  const properties = ['left', 'top', 'maxWidth', 'maxHeight', 'minWidth', 'visibility'];
  const initial = Object.fromEntries(properties.map(name => [name, menu.style[name]]));
  let frame = 0, destroyed = false, concealed = false;

  const open = () => menu.matches(':popover-open');
  const reveal = () => {
    if (!concealed) return;
    menu.style.visibility = initial.visibility;
    concealed = false;
  };
  const cancel = () => {
    if (frame) view.cancelAnimationFrame(frame);
    frame = 0;
    reveal();
  };
  const close = () => {
    cancel();
    if (open()) menu.hidePopover();
  };
  const place = () => {
    frame = 0;
    if (destroyed || !open()) { reveal(); return; }
    const root = menu.ownerDocument.documentElement;
    const bounds = {
      left: viewport?.offsetLeft || 0,
      top: viewport?.offsetTop || 0,
      width: viewport?.width ?? root.clientWidth,
      height: viewport?.height ?? root.clientHeight,
    };
    bounds.right = bounds.left + bounds.width;
    bounds.bottom = bounds.top + bounds.height;
    const anchor = button.getBoundingClientRect(), strip = toolbar.getBoundingClientRect();
    if (!button.isConnected || !toolbar.isConnected || !anchor.width || !anchor.height ||
        anchor.right <= Math.max(strip.left, bounds.left) || anchor.left >= Math.min(strip.right, bounds.right) ||
        anchor.bottom <= Math.max(strip.top, bounds.top) || anchor.top >= Math.min(strip.bottom, bounds.bottom)) {
      close();
      return;
    }
    const padding = 8, gap = 4;
    const width = Math.max(0, bounds.width - padding * 2);
    const height = Math.max(0, bounds.height - padding * 2);
    if (!width || !height) { close(); return; }
    menu.style.maxWidth = width + 'px';
    menu.style.minWidth = Math.min(170, width) + 'px';
    menu.style.maxHeight = height + 'px';
    const natural = menu.getBoundingClientRect();
    const below = Math.max(0, bounds.bottom - padding - anchor.bottom - gap);
    const above = Math.max(0, anchor.top - gap - bounds.top - padding);
    const flip = natural.height > below && above > below;
    menu.style.maxHeight = (flip ? above : below) + 'px';
    const size = menu.getBoundingClientRect();
    const left = Math.max(bounds.left + padding, Math.min(anchor.right - size.width, bounds.right - padding - size.width));
    const top = Math.max(bounds.top + padding, Math.min(flip ? anchor.top - gap - size.height : anchor.bottom + gap,
      bounds.bottom - padding - size.height));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    reveal();
  };
  const schedule = () => {
    if (!destroyed && open() && !frame) frame = view.requestAnimationFrame(place);
  };
  const beforeToggle = event => {
    if (event.newState === 'open') {
      menu.style.visibility = 'hidden';
      concealed = true;
      // beforetoggle runs while the popover is still display:none. Measure it
      // in the next rendering step, after native top-layer insertion.
      if (!frame) frame = view.requestAnimationFrame(place);
    } else cancel();
  };
  const toggle = event => {
    if (event.newState === 'open') {
      if (frame) view.cancelAnimationFrame(frame);
      place();
    } else cancel();
  };
  const action = event => {
    const target = event.target.closest?.('button');
    if (target && menu.contains(target) && !target.disabled) close();
  };
  const observer = new view.ResizeObserver(schedule);
  observer.observe(toolbar);
  observer.observe(button);
  observer.observe(menu);
  observer.observe(menu.ownerDocument.documentElement);
  toolbar.addEventListener('scroll', schedule, { passive: true });
  view.addEventListener('scroll', schedule, { passive: true, capture: true });
  view.addEventListener('resize', schedule, { passive: true });
  viewport?.addEventListener('resize', schedule, { passive: true });
  viewport?.addEventListener('scroll', schedule, { passive: true });
  menu.addEventListener('beforetoggle', beforeToggle);
  menu.addEventListener('toggle', toggle);
  menu.addEventListener('click', action);
  schedule();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      close();
      observer.disconnect();
      toolbar.removeEventListener('scroll', schedule);
      view.removeEventListener('scroll', schedule, true);
      view.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      menu.removeEventListener('beforetoggle', beforeToggle);
      menu.removeEventListener('toggle', toggle);
      menu.removeEventListener('click', action);
      for (const name of properties) menu.style[name] = initial[name];
    },
  };
}
