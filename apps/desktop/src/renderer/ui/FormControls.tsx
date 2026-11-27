import { MagnifyingGlassIcon as MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import type { ComponentPropsWithRef, ReactNode, RefObject } from 'react';
import { ZeusSelect, type ZeusSelectProps } from './ZeusSelect.js';

type TextInputProps = ComponentPropsWithRef<'input'>;
type ControlDensity = 'regular' | 'compact';
type SelectProps = Omit<ZeusSelectProps<string>, 'size' | 'triggerRef'> & {
  density?: ControlDensity;
  ref?: RefObject<HTMLButtonElement | null>;
};
type SearchInputProps = Omit<TextInputProps, 'type'> & { density?: ControlDensity };
type CheckboxFieldProps = Omit<ComponentPropsWithRef<'input'>, 'type' | 'className' | 'children'> & {
  className?: string;
  children: ReactNode;
};

export function TextInput({ className, ...props }: TextInputProps) {
  return <input {...props} className={['zeus-text-input', className].filter(Boolean).join(' ')} />;
}

export function Select({ className, density = 'regular', ref, ...props }: SelectProps) {
  const selected = props.options.find(option => option.value === props.value) ?? props.options.find(option => !option.disabled);
  return <ZeusSelect
    {...props}
    className={['zeus-form-select', className].filter(Boolean).join(' ')}
    value={selected?.value ?? ''}
    disabled={props.disabled || !props.options.some(option => !option.disabled)}
    onChange={value => {
      if (value !== props.value) props.onChange(value);
    }}
    triggerLabel={props.triggerLabel ?? selected?.label ?? props.ariaLabel}
    triggerTitle={props.triggerTitle ?? selected?.label}
    triggerRef={ref}
    size={density}
  />;
}

export function SearchInput({ className, density, ...props }: SearchInputProps) {
  return (
    <label className={['zeus-search-field', className].filter(Boolean).join(' ')} data-control-density={density}>
      <MagnifyingGlass aria-hidden="true" />
      <input {...props} type="search" />
    </label>
  );
}

export function CheckboxField({ className, children, title, ...props }: CheckboxFieldProps) {
  return (
    <label className={['zeus-check-field', className].filter(Boolean).join(' ')} title={title}>
      <input {...props} type="checkbox" />
      <span>{children}</span>
    </label>
  );
}
