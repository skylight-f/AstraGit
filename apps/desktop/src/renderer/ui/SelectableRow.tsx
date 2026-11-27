import type { ComponentPropsWithoutRef } from 'react';

type SelectableRowProps = ComponentPropsWithoutRef<'div'> & {
  selected: boolean;
};

export function SelectableRow({ className, selected, ...props }: SelectableRowProps) {
  return (
    <div
      {...props}
      className={['zeus-selectable-row', className].filter(Boolean).join(' ')}
      data-selected={selected}
    />
  );
}
