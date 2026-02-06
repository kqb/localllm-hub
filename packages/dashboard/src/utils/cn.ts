import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { clsx, ClassValue } from 'clsx';


export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
