import { render } from 'preact';
import { CURRENT_GENERATOR_VERSION } from '@seedbeat/core';
import { bootStage } from './render/stage';
import { Title } from './ui/Title';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

render(<Title generatorVersion={CURRENT_GENERATOR_VERSION} />, ui);

void bootStage(canvas);
