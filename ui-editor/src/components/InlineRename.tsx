import { useEffect, useRef, useState } from "react";

interface Props {
  name: string;
  caretMode?: "all" | "prefix";
  onCommit: (name: string) => void;
  onCancel: () => void;
}

/** 层级树内联重命名；自动命名时把光标放到最后一个下划线之后。 */
export default function InlineRename(p: Props) {
  const [value, setValue] = useState(p.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (p.caretMode === "prefix") {
      const position = p.name.lastIndexOf("_") + 1;
      input.setSelectionRange(position, position);
    } else {
      input.select();
    }
  }, [p.caretMode, p.name]);

  const commit = () => {
    if (finished.current) return;
    finished.current = true;
    p.onCommit(value);
  };
  const cancel = () => {
    if (finished.current) return;
    finished.current = true;
    p.onCancel();
  };

  return (
    <input
      ref={inputRef}
      className="inline-rename"
      value={value}
      aria-label={`重命名 ${p.name}`}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );
}
