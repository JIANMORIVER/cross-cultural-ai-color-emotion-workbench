import type { ExportRow, GewRow } from "./engine";

const BASE_URL = "http://127.0.0.1:8773";
export type HeterogeneityResult = {
  version:number; randomSeed:number; colors:string[]; emotions:string[]; humanSources:string[]; aiSources:string[];
  offlineNormalizationCount?:number;
  config:{stability:number;permutations:number;bootstrap:number;hungarian:number};
  qc:{rows:ExportRow[];includedProfiles:number;excluded:number;dimensions:number};
  subgroups:{validation:ExportRow[];assignmentsHuman:ExportRow[];assignmentsAi:ExportRow[];profiles:ExportRow[];composition:ExportRow[];pca:ExportRow[]};
  distribution:{energy:ExportRow[];mmd:ExportRow[];consistency:ExportRow[]};
  matching:{nn:ExportRow[];hungarian:ExportRow[];nnDistances:ExportRow[]}; method:Record<string,string>;
};
export type HeterogeneityJob={jobId:string;status:"running"|"completed"|"failed"|"cancelled";stage:string;completed:number;total:number;result?:HeterogeneityResult;error?:string};
export async function startHeterogeneityJob(rows:GewRow[],options:{seed:number;stability:number;permutations:number;bootstrap:number;hungarian:number}){let response:Response;try{response=await fetch(`${BASE_URL}/task2-heterogeneity-jobs`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rows,options})})}catch{throw new Error("个体异质性 Python 服务未启动，请重启 3006。")};const payload=await response.json().catch(()=>({})) as {jobId?:string;message?:string};if(!response.ok||!payload.jobId)throw new Error(payload.message||`启动失败（HTTP ${response.status}）`);return payload.jobId}
export async function getHeterogeneityJob(jobId:string){const response=await fetch(`${BASE_URL}/task2-heterogeneity-jobs/${jobId}`,{cache:"no-store"});const payload=await response.json().catch(()=>({})) as HeterogeneityJob&{message?:string};if(!response.ok)throw new Error(payload.message||`查询失败（HTTP ${response.status}）`);return payload}
export async function cancelHeterogeneityJob(jobId:string){const response=await fetch(`${BASE_URL}/task2-heterogeneity-jobs/${jobId}`,{method:"DELETE"});if(!response.ok)throw new Error("取消任务失败。")}
