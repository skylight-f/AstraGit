import type { ComponentPropsWithRef, ReactNode } from 'react';

type TextInputProps = ComponentPropsWithRef<'input'>;
type SelectProps = ComponentPropsWithRef<'select'>;
type CheckboxFieldProps = Omit<ComponentPropsWithRef<'input'>, 'type' | 'className' | 'children'> & {
  className?: string;
  children: ReactNode;
};

export function TextInput({ className, ...props }: TextInputProps) {
  return <input {...props} className={['zeus-text-input', className].filter(Boolean).join(' ')} />;
}

export function Select({ className, ...props }: SelectProps) {
  return <select {...props} className={['zeus-native-select', className].filter(Boolean).join(' ')} />;
}

export function CheckboxField({ className, children, title, ...props }: CheckboxFieldProps) {
  return (
    <label className={['zeus-check-field', className].filter(Boolean).join(' ')} title={title}>
      <input {...props} type="checkbox" />
      <span>{children}</span>
    </label>
  );
}
