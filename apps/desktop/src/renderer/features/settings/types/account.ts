import { ReactNode } from "react";

export type AccountFormValues = {
  [key: string]: any;
};

export type AccountResponse = AccountFormValues & {
  id: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export interface FieldProps {
  label: string;
  description?: string;
  htmlFor: string;
  className?: string;
  children: ReactNode;
}
