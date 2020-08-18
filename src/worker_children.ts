// @ts-nocheck
import { isMainThread } from "worker_threads";
import { workerData } from "worker_threads";
import { parentPort } from "worker_threads";

if (isMainThread) {
  throw new Error("Its not a worker");
}

parentPort.on("message", (data: any) => {
  console.log('child message do', data)
  setTimeout(() => {
    parentPort.postMessage("hello parents: " + data);
  }, 3000);
});

console.log("child start", workerData);
