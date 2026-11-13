// The sheet's shared pieces: fields, marks, sections and references, each drawn
// from a React Aria Component or native HTML and styled by its state attributes.
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import {
  Button, Checkbox, Disclosure, DisclosurePanel, Heading, Input, Label, Link, ListBox, ListBoxItem,
  Popover, Select, SelectValue, TextArea, TextField,
} from 'react-aria-components';
import { needsAttention, statusMark } from './model.ts';
import type { State, Store } from './store.ts';

export const StoreContext = createContext<Store | null>(null);
export const useStore = () => useContext(StoreContext)!;
export function useStoreState(): State {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** A status: its mark and its word, red only for a difference the reader must attend to. */
export function Status({ value, label = value }: { value: string; label?: string }) {
  return <span className={`status${needsAttention(value) ? ' attend' : ''}`}><span aria-hidden="true">{`${statusMark(value)} `}</span>{label}</span>;
}

/** A section: its name in capitals and a rule drawn out to the edge. */
export function Section({ title, className = '', children }: { title: string; className?: string; children?: ReactNode }) {
  return <section className={`section ${className}`.trim()}><h3>{title}</h3>{children}</section>;
}

/** Something the reader may open: native-looking, keyboard-reachable, named by its title. */
export function Expand({ title, section = false, open = false, className = '', level = 3, children }: { title: string; section?: boolean; open?: boolean; className?: string; level?: number; children?: ReactNode }) {
  return (
    <Disclosure className={`expand${section ? ' section' : ''}${className ? ` ${className}` : ''}`} defaultExpanded={open}>
      <Heading level={level} className="expand-head"><Button slot="trigger" className="expand-trigger">{title}</Button></Heading>
      <DisclosurePanel className="expand-panel">{children}</DisclosurePanel>
    </Disclosure>
  );
}

/** An author's rendered Markdown. The renderer already removed HTML, scripts and images. */
export function Prose({ html, className = '' }: { html?: string; className?: string }) {
  return <div className={`prose ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html ?? '' }} />;
}

/** The author's stated uncertainty, beside the claim it qualifies. */
export function Uncertainty({ text }: { text: string }) {
  return <div className="uncertainty"><span className="cap">Uncertainty</span><p className="words">{text}</p></div>;
}

/** A reference to another record: its name, leading to its place in the reader. */
export function RefLink({ href, children, isDisabled = false, className = '' }: { href: string; children: ReactNode; isDisabled?: boolean; className?: string }) {
  return <Link href={href} isDisabled={isDisabled} className={`ref ${className}`.trim()}>{children}</Link>;
}

export function Action({ children, onPress, primary = false, danger = false, isDisabled, className = '', label, id }: { children: ReactNode; onPress: () => unknown; primary?: boolean; danger?: boolean; isDisabled?: boolean; className?: string; label?: string; id?: string }) {
  const store = useStore();
  return <Button id={id} aria-label={label} className={`button${primary ? ' primary' : ''}${danger ? ' danger' : ''}${className ? ` ${className}` : ''}`} isDisabled={isDisabled} onPress={() => void store.run(onPress)}>{children}</Button>;
}

export function TextInput({ label, value, onChange, placeholder, isDisabled, isRequired, ariaLabel, className = '' }: { label?: string; value: string; onChange: (value: string) => void; placeholder?: string; isDisabled?: boolean; isRequired?: boolean; ariaLabel?: string; className?: string }) {
  return (
    <TextField className={`field ${className}`.trim()} value={value} onChange={onChange} isDisabled={isDisabled} isRequired={isRequired} aria-label={label ? undefined : ariaLabel}>
      {label ? <Label>{label}</Label> : null}
      <Input placeholder={placeholder} />
    </TextField>
  );
}

export function TextBox({ label, value, onChange, placeholder, isDisabled, isReadOnly, ariaLabel, className = '', code = false, short = false }: { label?: string; value: string; onChange?: (value: string) => void; placeholder?: string; isDisabled?: boolean; isReadOnly?: boolean; ariaLabel?: string; className?: string; code?: boolean; short?: boolean }) {
  return (
    <TextField className={`field ${className}`.trim()} value={value} onChange={onChange} isDisabled={isDisabled} isReadOnly={isReadOnly} aria-label={label ? undefined : ariaLabel}>
      {label ? <Label>{label}</Label> : null}
      <TextArea placeholder={placeholder} className={`react-aria-TextArea${code ? ' code' : ''}${short ? ' short-text' : ''}`} />
    </TextField>
  );
}

// React Aria keys cannot be empty; an empty value stands for "none" or "all".
const empty = '\u0000';
export type Option = { id: string; name: string };
export function Choice({ label, value, onChange, options, ariaLabel, className = '', isDisabled }: { label?: string; value: string; onChange: (value: string) => void; options: Option[]; ariaLabel?: string; className?: string; isDisabled?: boolean }) {
  const items = options.map(option => ({ ...option, key: option.id === '' ? empty : option.id }));
  return (
    <Select className={`field choice ${className}`.trim()} value={value === '' ? empty : value} onChange={key => onChange(key === empty ? '' : String(key ?? ''))} aria-label={label ? undefined : ariaLabel} isDisabled={isDisabled}>
      {label ? <Label>{label}</Label> : null}
      <Button className="choice-button"><SelectValue className="choice-value" /><span className="choice-mark" aria-hidden="true">▾</span></Button>
      <Popover className="choice-popover" offset={4}>
        <ListBox className="choice-list" items={items}>
          {item => <ListBoxItem id={item.key} textValue={item.name} className="choice-option">{item.name}</ListBoxItem>}
        </ListBox>
      </Popover>
    </Select>
  );
}

export function Tick({ checked, onChange, children, isDisabled, className = '' }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; isDisabled?: boolean; className?: string }) {
  return (
    <Checkbox className={`tick ${className}`.trim()} isSelected={checked} onChange={onChange} isDisabled={isDisabled}>
      <span className="tick-box" aria-hidden="true" />
      <span className="tick-label">{children}</span>
    </Checkbox>
  );
}
