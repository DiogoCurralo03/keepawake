import koffi from 'koffi';
import { isWindowsElevated } from '../src/windows.js';

console.log(`Native runtime ready (${process.arch}, koffi ${koffi.version}, elevated: ${isWindowsElevated()})`);
