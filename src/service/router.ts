/*
Copyright 2024 Julio Fernandez

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
import express from 'express'
import Router from 'express-promise-router'
import { AuthService, BackstageUserInfo, DiscoveryService, HttpAuthService, LoggerService, RootConfigService, UserInfoService } from '@backstage/backend-plugin-api'
import { CatalogClient } from '@backstage/catalog-client'
import { UserEntity } from '@backstage/catalog-model'
import { FetchApi } from '@backstage/core-plugin-api'

// Kwirth
import { ANNOTATION_BACKSTAGE_KUBERNETES_LABELSELECTOR, ClusterValidPods, MetricDefinition, PodData } from '@jfvilas/plugin-kwirth-common'
import { loadClusters, loadKwirthInfo } from './config'
import { KwirthStaticData } from '../model/KwirthStaticData'
import { checkNamespaceAccess, checkPodAccess, getPodPermissionSet } from './permissions'
import { accessKeySerialize, InstanceConfigScopeEnum, versionGreaterThan } from '@jfvilas/kwirth-common'
import { VERSION } from '../version'

export type KwirthRouterOptions = {
    discoverySvc: DiscoveryService
    configSvc: RootConfigService
    loggerSvc: LoggerService
    userInfoSvc: UserInfoService
    authSvc: AuthService
    httpAuthSvc: HttpAuthService
}

// const debug = (a:any)  => {
//     if (process.env.KWIRTHDEBUG) console.log(a)
// }

/**
 * 
 * @param options core services we need for Kwirth to work
 * @returns an express Router
 */
async function createRouter(options: KwirthRouterOptions) : Promise<express.Router> {
    const { configSvc, loggerSvc, userInfoSvc, authSvc, httpAuthSvc, discoverySvc } = options;

    loggerSvc.info('Loading static config')

    if (!configSvc.has('kubernetes.clusterLocatorMethods')) {
        loggerSvc.error(`Kwirth will not start, there is no 'clusterLocatorMethods' defined in app-config.`)
        throw new Error('Kwirth backend will not be available.')
    }

    try {
        loadClusters(loggerSvc, configSvc)
        loadKwirthInfo(loggerSvc)
    }
    catch (err) {
        let txt=`Errors detected reading static configuration: ${err}`
        loggerSvc.error(txt)
        throw new Error(txt)
    }

    // subscribe to changes on app-config
    if (configSvc.subscribe) {
        configSvc.subscribe( () => {
            try {
                loggerSvc.warn('Change detected on app-config, Kwirth will update config.')
                loadClusters(loggerSvc, configSvc)
            }
            catch(err) {
                loggerSvc.error(`Errors detected reading new configuration: ${err}`)
            }
        })
    }
    else {
        loggerSvc.info('Kwirth cannot subscribe to config changes.')
    }

    const router = Router()

    router.use(express.json())

    // we need this function to be able to invoke another backend plugin passing an authorization token
    const createAuthFetchApi = (token: string) : FetchApi => {
        return {
            fetch: async (input, init) => {
                init = init || {}
                init.headers = {
                    ...init.headers,
                    Authorization: `Bearer ${token}`,
                }
                return fetch(input, init)
            }
        }
    }

    /**
     * Invokes Kwirth to obtain a list of pods that are tagged with the kubernetes-id of the entity we are looking for.
     * @param entityName name of the tagge dentity
     * @returns a ClusterValidPods[] (each ClusterValidPods is a cluster info with a list of pods tagged with the entityName).
     */
    // const getValidClusters = async (entityName:string) : Promise<ClusterValidPods[]> => {
    //     let clusterList:ClusterValidPods[]=[]

    //     for (const clusterName of KwirthStaticData.clusterKwirthData.keys()) {
    //         let url = KwirthStaticData.clusterKwirthData.get(clusterName)?.kwirthHome as string
    //         let apiKeyStr = KwirthStaticData.clusterKwirthData.get(clusterName)?.kwirthApiKey
    //         let title = KwirthStaticData.clusterKwirthData.get(clusterName)?.title
    //         // ways to select components:
    //         // label id:
    //         //   'backstage.io/kubernetes-id': 'xxxxx'
    //         // label selector:
    //         //   'backstage.io/kubernetes-label-selector': 'app=my-app,component=front-end'
    //         let queryUrl=url+`/managecluster/find?label=backstage.io%2fkubernetes-id&entity=${entityName}&type=pod&data=containers`
    //         try {
    //             let fetchResp = await fetch (queryUrl, {headers:{'Authorization':'Bearer '+apiKeyStr}})
    //             if (fetchResp.status===200) {
    //                 let jsonResp=await fetchResp.json()
    //                 if (jsonResp) {
    //                     let podData:ClusterValidPods = {
    //                         name: clusterName, url, title, data: jsonResp, accessKeys: new Map()
    //                     }
    //                     clusterList.push(podData)
    //                 }
    //             }
    //             else {
    //                 loggerSvc.warn(`Invalid response from cluster ${clusterName}: ${fetchResp.status}`)
    //                 console.log(await fetchResp.text())
    //                 clusterList.push({ name: clusterName, url, title, data:[], accessKeys:new Map() })
    //             }

    //         }
    //         catch (err) {
    //             loggerSvc.warn(`Cannot access cluster ${clusterName} (URL: ${queryUrl}): ${err}`)
    //             clusterList.push({ name: clusterName, url, title, data:[], accessKeys:new Map() })
    //         }
    //     }

    //     return clusterList
    // }

    const getValidClustersFromEntity = async (entity:any) : Promise<ClusterValidPods[]> => {
        let clusterList:ClusterValidPods[]=[]

        for (const clusterName of KwirthStaticData.clusterKwirthData.keys()) {
            let url = KwirthStaticData.clusterKwirthData.get(clusterName)?.kwirthHome as string
            let apiKeyStr = KwirthStaticData.clusterKwirthData.get(clusterName)?.kwirthApiKey
            let title = KwirthStaticData.clusterKwirthData.get(clusterName)?.title
            let clusterVersion = KwirthStaticData.clusterKwirthData.get(clusterName)?.kwirthData.version || '0.0.0'

            // ways to select components:
            // label id:
            //   'backstage.io/kubernetes-id': 'xxxxx'
            // label selector:
            //   'backstage.io/kubernetes-label-selector': 'app=my-app,component=front-end'
            let queryUrl = undefined
            if (entity.metadata.annotations['backstage.io/kubernetes-id']) {
                queryUrl=url+`/managecluster/find?label=backstage.io%2fkubernetes-id&entity=${entity.metadata.annotations['backstage.io/kubernetes-id']}&type=pod&data=containers`
            }
            else if (entity.metadata.annotations['backstage.io/kubernetes-label-selector']) {
                if (versionGreaterThan(clusterVersion,'0.4.40')) {
                    let escapedLabelSelector = encodeURIComponent(entity.metadata.annotations['backstage.io/kubernetes-label-selector'])
                    queryUrl=url+`/managecluster/find?labelselector=${escapedLabelSelector}&type=pod&data=containers`
                }
                else {
                    loggerSvc.error(`Version ${clusterVersion} from cluster ${clusterName} is not valid for using ${ANNOTATION_BACKSTAGE_KUBERNETES_LABELSELECTOR}`)
                    clusterList.push({ name: clusterName, url, title, pods:[], accessKeys:new Map() })
                    continue
                }
            }
            else {
                loggerSvc.error('Received request without labelid/labelselector')
                clusterList.push({ name: clusterName, url, title, pods:[], accessKeys:new Map() })
                continue
            }

            try {
                let fetchResp = await fetch (queryUrl, {headers:{'Authorization':'Bearer '+apiKeyStr}})
                if (fetchResp.status===200) {
                    let jsonResp=await fetchResp.json()
                    if (jsonResp) {
                        let podData:ClusterValidPods = {
                            name: clusterName, url, title, pods: jsonResp, accessKeys: new Map()
                        }
                        clusterList.push(podData)
                    }
                    else {
                        loggerSvc.warn(`Invalid data received from cluster ${clusterName}`)
                        clusterList.push({ name: clusterName, url, title, pods:[], accessKeys:new Map() })
                    }
                }
                else {
                    loggerSvc.warn(`Invalid response from cluster ${clusterName}: ${fetchResp.status}`)
                    let text = await fetchResp.text()
                    if (text) loggerSvc.warn(text)
                    clusterList.push({ name: clusterName, url, title, pods:[], accessKeys:new Map() })
                }

            }
            catch (err) {
                loggerSvc.warn(`Cannot access cluster ${clusterName} (URL: ${queryUrl}): ${err}`)
                clusterList.push({ name: clusterName, url, title, pods:[], accessKeys:new Map() })
            }
        }

        return clusterList
    }

    const createAccessKey = async (reqScope:InstanceConfigScopeEnum, cluster:ClusterValidPods, reqPods:PodData[], userName:string) : Promise<any> => {
        let resources = reqPods.map(podData => `${reqScope}:${podData.namespace}::${podData.name}:`).join(';')

        let kwirthHome = KwirthStaticData.clusterKwirthData.get(cluster.name)?.kwirthHome as string
        let kwirthApiKey = KwirthStaticData.clusterKwirthData.get(cluster.name)?.kwirthApiKey
        let payload= {
            description: `Backstage API key for user ${userName}`,
            expire: Date.now()+60*60*1000,
            days: 1,
            accessKey: {
                id: '',
                type:'bearer',
                resources
            }
        }

        let fetchResp=await fetch(kwirthHome+'/key',{method:'POST', body:JSON.stringify(payload), headers:{'Content-Type':'application/json', Authorization:'Bearer '+kwirthApiKey}})
        if (fetchResp.status===200) {
            let data = await fetchResp.json()
            return data.accessKey
        }
        else {
            loggerSvc.warn(`Invalid response asking for a key from cluster ${cluster.name}: ${fetchResp.status}`)
            return undefined
        }
    }

    const addAccessKeys = async (channel:string, reqScope:InstanceConfigScopeEnum, foundClusters:ClusterValidPods[], entityName:string, userEntityRef:string, userGroups:string[]) => {
        if (!reqScope) {
            loggerSvc.info(`Invalid scope requested: ${reqScope}`)
            return
        }
        let principal=userEntityRef.split(':')[1]
        let username=principal.split('/')[1]

        for (let foundCluster of foundClusters) {
            let podList:PodData[]=[]

            if ( !KwirthStaticData.clusterKwirthData.get(foundCluster.name)?.kwirthData.channels.some(c => c.id === channel) ) {
                loggerSvc.warn(`Cluster ${foundCluster.name} does not implement channel ${channel} (requested scope: ${reqScope})`)
                continue
            }

            // for each pod we've found on the cluster we check all namespace permissions
            for (let podData of foundCluster.pods) {
                // first we check if user is allowed to acccess namespace
                let allowedToNamespace = checkNamespaceAccess(channel, foundCluster, podData, userEntityRef, userGroups)

                if (allowedToNamespace) {
                    // then we check if required pod namespace has pod access restriccions for requested namespace
                    let clusterDef = KwirthStaticData.clusterKwirthData.get(foundCluster.name)
                    let podPermissionSet = getPodPermissionSet(channel, clusterDef!)
                    if (!podPermissionSet) {
                        loggerSvc.warn(`Pod permission set not found: ${channel}`)
                        continue
                    }
                    let namespaceRestricted = podPermissionSet.some(pp => pp.namespace===podData.namespace);
                    if (!namespaceRestricted || checkPodAccess(podData, podPermissionSet, entityName, userEntityRef, userGroups)) {
                        // there are no namespace restrictions specified in the pod permission set
                        podList.push(podData)
                    }
                    else {
                    }
                }
                else {
                    // user is not allowed to namespace, so we don't need to check pod permissions
                    // the loop cotinues with other pods
                }
            }
            if (podList.length>0) {
                let accessKey = await createAccessKey(reqScope, foundCluster, podList, username)
                if (accessKey) foundCluster.accessKeys.set(reqScope, accessKey)
            }
            else {
                loggerSvc.info(`No pods on podList for '${reqScope}' on channel '${channel}' in cluster '${foundCluster.name}' for searching for entity: '${entityName}'`)
            }
        }
    }

    /**
     * builds a list of groups (expressed as identity refs) that the user belongs to.
     * @param userInfo Backstage user info of the user to search groups for
     * @returns an array of group refs in canonical form
     */
    const getUserGroups = async (userInfo:BackstageUserInfo) : Promise<string[]> => {
        const { token } = await authSvc.getPluginRequestToken({
            onBehalfOf: await authSvc.getOwnServiceCredentials(),
            targetPluginId: 'catalog'
        });
        const catalogClient = new CatalogClient({
            discoveryApi: discoverySvc,
            fetchApi: createAuthFetchApi(token),
        });

        const entity = await catalogClient.getEntityByRef(userInfo.userEntityRef) as UserEntity
        let userGroupsRefs:string[]=[]
        //+++ future use: recursive memberOf
        if (entity?.spec.memberOf) userGroupsRefs=entity?.spec.memberOf
        return userGroupsRefs
    }

    // this is and API endpoint controller
    const processVersion = async (_req:any, res:any) => {
        res.status(200).send({ version:VERSION })
    }

    // this is and API endpoint controller
    const processInfo = async (_req:any, res:any) => {
        res.status(200).send(
            KwirthStaticData.latestVersions
        )
    }

    // this is and API endpoint controller
    const processAccess = async (req:express.Request, res:express.Response) => {
        if (!req.query['scopes'] || !req.query['channel']) {
            res.status(400).send(`'scopes' and 'channel' are required`)
            return
        }
        let reqScopes = (req.query['scopes'].toString()).split(',')
        let reqChannel = req.query['channel']?.toString()!
    
        // obtain basic user info
        const credentials = await httpAuthSvc.credentials(req, { allow: ['user'] })
        const userInfo = await userInfoSvc.getUserInfo(credentials)
        // get user groups list
        let userGroupsRefs=await getUserGroups(userInfo)

        loggerSvc.info(`Checking reqScopes '${req.query['scopes']}' scopes for working with pod: '${req.body.metadata.namespace+'/'+req.body.metadata.name}' for user '${userInfo.userEntityRef}'`)

        //+++ control errors here (maybe we cannot contact the cluster, for example)
        // get a list of clusters that contain pods related to entity
        //let foundClusters:ClusterValidPods[] = await getValidClustersFromEntity(req.body.metadata.name)
        let foundClusters:ClusterValidPods[] = await getValidClustersFromEntity(req.body)

        // add access keys to authorized resources (according to group membership and Kwirth config in app-config (namespace and pod permissions))
        for (let reqScopeStr of reqScopes) {
            let reqScope = reqScopeStr as InstanceConfigScopeEnum
            await addAccessKeys(reqChannel, reqScope, foundClusters, req.body.metadata.name, userInfo.userEntityRef, userGroupsRefs)
            if (reqScope === InstanceConfigScopeEnum.STREAM) {
                for (let cluster of foundClusters) {
                    let accessKey = cluster.accessKeys.get(InstanceConfigScopeEnum.STREAM)
                    if (accessKey) {
                        let url = cluster.url+'/metrics'
                        let auth = 'Bearer '+accessKeySerialize(accessKey)
                        let fetchResp = await fetch (url, {headers:{'Authorization':auth}})
                        try {
                            let data = (await fetchResp.json()) as MetricDefinition[]
                            cluster.metrics = data
                        }
                        catch (err) {
                            loggerSvc.error(`Cannot get metrics on cluster ${cluster.name}: `+err)
                        }
                    }
                    // else {
                    //     loggerSvc.warn(`Couldn't get accessKey for getting metrics list for cluster ${cluster.name}`)
                    // }
                }
            }
        }
    
        // *** we build a string of arrays from the Map (Maps cannot be serialized)
        for (let c of foundClusters) {
            (c as any).accessKeys = JSON.stringify(Array.from(c.accessKeys.entries()))
        }
        res.status(200).send(foundClusters)
    }

    router.post(['/access'], (req, res) => {
        processAccess(req,res)
    })

    router.get(['/version'], (req, res) => {
        processVersion(req,res)
    })

    router.get(['/info'], (req, res) => {
        processInfo(req,res)
    })

    return router
}

export { createRouter }
