#!/usr/bin/env node
import process from 'node:process';import {run} from '../src/cli.mjs';try{process.exitCode=run();}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=2;}
