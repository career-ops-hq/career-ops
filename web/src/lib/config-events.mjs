export const CONFIG_KEY = "career-ops:config";
export const CONFIG_EVENT = "career-ops:config-changed";

/**
 * @param {Pick<Storage, "setItem">} storage
 * @param {EventTarget | null} target
 * @param {Record<string, unknown>} value
 */
export function writeConfig(storage, target, value) {
  storage.setItem(CONFIG_KEY, JSON.stringify(value));
  target?.dispatchEvent(new Event(CONFIG_EVENT));
}

/**
 * @param {EventTarget} target
 * @param {() => void} onChange
 */
export function subscribeConfig(target, onChange) {
  /** @param {Event} event */
  const onStorage = (event) => {
    const key = "key" in event ? event.key : null;
    if (key == null || key === CONFIG_KEY) onChange();
  };
  target.addEventListener("storage", onStorage);
  target.addEventListener(CONFIG_EVENT, onChange);
  return () => {
    target.removeEventListener("storage", onStorage);
    target.removeEventListener(CONFIG_EVENT, onChange);
  };
}
