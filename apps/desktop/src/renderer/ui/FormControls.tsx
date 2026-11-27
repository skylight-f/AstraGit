import { MagnifyingGlassIcon as MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import type { ComponentPropsWithRef, ReactNode } from 'react';

type TextInputProps = ComponentPropsWithRef<'input'>;
type ControlDensity = 'regular' | 'compact';
type SelectProps = ComponentPropsWithRef<'select'> & { density?: ControlDensity };
type SearchInputProps = Omit<TextInputProps, 'type'> & { density?: ControlDensity };
type CheckboxFieldProps = Omit<ComponentPropsWithRef<'input'>, 'type' | 'className' | 'children'> & {
  className?: string;
  children: ReactNode;
};

export function TextInput({ className, ...props }: TextInputProps) {
  return <input {...props} className={['zeus-text-input', className].filter(Boolean).join(' ')} />;
}

export function Select({ className, density, ...props }: SelectProps) {
  return <select {...props} className={['zeus-native-select', className].filter(Boolean).join(' ')} data-control-density={density} />;
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
