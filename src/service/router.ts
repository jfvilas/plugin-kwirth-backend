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
import { ClusterValidPods, PodData } from '@jfvilas/plugin-kwirth-common'
import { loadClusters } from './config'
import { KwirthStaticData, VERSION } from '../model/KwirthStaticData'
import { checkNamespaceAccess, checkPodAccess, getPodPermissionSet } from './permissions'
import { InstanceConfigScopeEnum } from '@jfvilas/kwirth-common'

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
    }
    catch (err) {
        var txt=`Errors detected reading static configuration: ${err}`
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
    const getValidClusters = async (entityName:string) : Promise<ClusterValidPods[]> => {
        var clusterList:ClusterValidPods[]=[]

        for (const clusterName of KwirthStaticData.clusterKwirthData.keys()) {
            var url = KwirthStaticData.clusterKwirthData.get(clusterName)?.kwirthHome as string
            var apiKeyStr = KwirthStaticData.clusterKwirthData.get(clusterName)?.kwirthApiKey
            var title = KwirthStaticData.clusterKwirthData.get(clusterName)?.title
            var queryUrl=url+`/managecluster/find?label=backstage.io%2fkubernetes-id&entity=${entityName}&type=pod&data=containers`
            try {
                var fetchResp = await fetch (queryUrl, {headers:{'Authorization':'Bearer '+apiKeyStr}})
                if (fetchResp.status===200) {
                    var jsonResp=await fetchResp.json()
                    if (jsonResp) {
                        let podData:ClusterValidPods = {
                            name: clusterName, url, title, data: jsonResp, accessKeys: new Map()
                        }
                        clusterList.push(podData)
                    }
                }
                else {
                    loggerSvc.warn(`Invalid response from cluster ${clusterName}: ${fetchResp.status}`)
                    console.log(await fetchResp.text())
                    clusterList.push({ name: clusterName, url, title, data:[], accessKeys:new Map() })
                }

            }
            catch (err) {
                loggerSvc.warn(`Cannot access cluster ${clusterName} (URL: ${queryUrl}): ${err}`)
                clusterList.push({ name: clusterName, url, title, data:[], accessKeys:new Map() })
            }
        }

        return clusterList
    }

    const createAccessKey = async (reqScope:InstanceConfigScopeEnum, cluster:ClusterValidPods, reqPods:PodData[], userName:string) : Promise<any> => {
        var resources = reqPods.map(podData => `${reqScope}:${podData.namespace}::${podData.name}:`).join(',')

        var kwirthHome = KwirthStaticData.clusterKwirthData.get(cluster.name)?.kwirthHome as string
        var kwirthApiKey = KwirthStaticData.clusterKwirthData.get(cluster.name)?.kwirthApiKey
        var payload={
            type:'bearer',
            resource: resources,
            description:`Backstage API key for user ${userName}`,
            expire:Date.now()+60*60*1000
        }
        var fetchResp=await fetch(kwirthHome+'/key',{method:'POST', body:JSON.stringify(payload), headers:{'Content-Type':'application/json', Authorization:'Bearer '+kwirthApiKey}})
        if (fetchResp.status===200) {
            var data = await fetchResp.json();
            return data.accessKey
        }
        else {
            loggerSvc.warn(`Invalid response asking for a key from cluster ${cluster.name}: ${fetchResp.status}`)
            return {}
        }
    }

    const addAccessKeys = async (channel:string, reqScope:InstanceConfigScopeEnum, foundClusters:ClusterValidPods[], entityName:string, userEntityRef:string, userGroups:string[]) => {
        //var reqScope:InstanceConfigScopeEnum = reqScopeStr as InstanceConfigScopeEnum
        if (!reqScope) {
            loggerSvc.info(`Invalid scope requested: ${reqScope}`)
            return
        }
        var principal=userEntityRef.split(':')[1]
        var username=principal.split('/')[1]

        for (var foundCluster of foundClusters) {
            var podList:PodData[]=[]

            // for each pod we've found on the cluster we check all namespace permissions

            for (var podData of foundCluster.data) {
                // first we check if user is allowed to acccess namespace
                var allowedToNamespace = checkNamespaceAccess(channel, foundCluster, podData, userEntityRef, userGroups)

                if (allowedToNamespace) {
                    // then we check if required pod namespace has pod access restriccions for requested namespace
                    var clusterDef = KwirthStaticData.clusterKwirthData.get(foundCluster.name)
                    var podPermissionSet = getPodPermissionSet(channel, clusterDef!)
                    if (!podPermissionSet) {
                        loggerSvc.warn(`Pod permission set not found: ${channel}`)
                        continue
                    }
                    var namespaceRestricted = podPermissionSet.some(pp => pp.namespace===podData.namespace);
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
                foundCluster.accessKeys.set(reqScope, accessKey)
            }
            else {
                console.log(`No pods on podList for ${channel} and ${reqScope}`)
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
        var userGroupsRefs:string[]=[]
        //+++ future use: recursive memberOf
        if (entity?.spec.memberOf) userGroupsRefs=entity?.spec.memberOf
        return userGroupsRefs
    }

    // this is and API endpoint controller
    const processVersion = async (_req:any, res:any) => {
        res.status(200).send({ version:VERSION })
    }

    // this is and API endpoint controller
    const processAccess = async (req:express.Request, res:express.Response) => {
        if (!req.query['scopes'] || !req.query['scopes']) {
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

        loggerSvc.info(`Checking reqScopes '${req.query['scopes']}' scopes to pod: '${req.body.metadata.namespace+'/'+req.body.metadata.name}' for user '${userInfo.userEntityRef}'`)

        // get a list of clusters that contain pods related to entity
        //+++ control errors here (maybe we cannot conntact the cluster, for example)
        let foundClusters:ClusterValidPods[]=await getValidClusters(req.body.metadata.name)

        // add access keys to authorized resources (according to group membership and Kwirth config in app-config (namespace and pod permissions))
        for (var reqScopeStr of reqScopes) {
            var reqScope = reqScopeStr as InstanceConfigScopeEnum
            await addAccessKeys(reqChannel, reqScope, foundClusters, req.body.metadata.name, userInfo.userEntityRef, userGroupsRefs)
        }
    
        // we build a stringn of arrays from the Map /that can not be serialized)
        for (var c of foundClusters) {
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

    return router
}

export { createRouter }
