export type HTMLInputKind =
  | 'text' | 'email' | 'password' | 'tel' | 'url' | 'number' | 'search'
  | 'date' | 'datetime-local' | 'time' | 'month' | 'week'
  | 'checkbox' | 'radio' | 'file' | 'color' | 'range' | 'hidden';

export type WidgetType =
  | { kind: 'native-input'; type: HTMLInputKind }
  | { kind: 'native-textarea' }
  | { kind: 'native-select'; multiple: boolean }
  | { kind: 'unsupported'; reason: string };

export interface FieldLabel {
  text: string;
  source: 'label' | 'aria-label' | 'placeholder' | 'title' | 'nearby' | 'legend';
}

export interface FieldValidation {
  required?: boolean;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  min?: string;
  max?: string;
}

export interface FieldDescriptor {
  id: string;                       // stable selector assigned by scanner
  selector: string;                 // CSS selector suitable for querySelector
  widget: WidgetType;
  labels: FieldLabel[];
  attributes: {
    name?: string;
    id?: string;
    autocomplete?: string;
    placeholder?: string;
    ariaLabel?: string;
    title?: string;
    type?: string;
  };
  options?: string[];               // for select / radio group
  validation?: FieldValidation;
  context: {
    nearbyText?: string;
    formTitle?: string;
  };
}
