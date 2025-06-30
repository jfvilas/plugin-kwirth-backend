/*
Copyright 2024 Julio Fernandez

Licensed under the Apache License, Version 2.0 (the "License")
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
import { LoggerService, RootConfigService } from '@backstage/backend-plugin-api'
import { KwirthStaticData, MIN_KWIRTH_VERSION } from '../model/KwirthStaticData'
import { KwirthClusterData, KwirthNamespacePermissions, KwirthPodPermissions, PodPermissionRule } from '../model/KwirthClusterData'
import { Config } from '@backstage/config'
import { ClusterTypeEnum, InstanceMessageChannelEnum, KwirthData, versionGreatOrEqualThan } from '@jfvilas/kwirth-common'


/**
 * loads Namespace Permissions setting from app-config xml
 * @param channelConfig name of the Kwirth channel to read ('metrics', 'log'...)
 * @param logger Logger service
 */
const loadNamespacePermissions = (channelConfig:Config, logger:LoggerService):KwirthNamespacePermissions[] => {
    var namespacePermissions:KwirthNamespacePermissions[] = []
    if (channelConfig.has('namespacePermissions')) {
        logger.info(`  Namespace permisson evaluation will be performed.`)
        var permNamespaces= (channelConfig.getOptionalConfigArray('namespacePermissions'))!
        for (var ns of permNamespaces) {
            var namespace=ns.keys()[0]
            var identityRefs=ns.getStringArray(namespace)
            identityRefs=identityRefs.map(g => g.toLowerCase())
            namespacePermissions.push ({ namespace, identityRefs })
        }
    }
    else {
        logger.info(`  No namespace restrictions.`)
        namespacePermissions=[]
    }
    return namespacePermissions
}

/**
 * read rules about permissions to a pply to a set of pods
 * @param config an object config read from app-config
 * @param category a permission category, one of: allow, deny unless, except
 * @returns an array of PodPermissionRule's
 */
const loadPodRules = (config:Config, category:string):PodPermissionRule[] => {
    var rules:PodPermissionRule[]=[]
    for (var rule of config.getConfigArray(category)) {
        var podsStringArray = rule.getOptionalStringArray('pods') || ['.*']
        var podsRegexArray:RegExp[]=[]
        for (var expr of podsStringArray) {
            podsRegexArray.push(new RegExp(expr))
        }

        var refsStringArray = rule.getOptionalStringArray('refs') || ['.*']
        var refsRegexArray:RegExp[]=[]
        for (var expr of refsStringArray) {
            refsRegexArray.push(new RegExp(expr))
        }

        var prr:PodPermissionRule={
            pods:podsRegexArray,
            refs:refsRegexArray
        }
        rules.push(prr)
    }
    return rules
}

/**
 * loads pod permissions (namespace and pod) for a specific Kwirth channel
 * @param channelConfig then name of the key (inside app-config) to read config from
 * @param logger Logger service
 * @returns an array of pod permissions
 */
const loadPodPermissions = (channelConfig:Config, logger:LoggerService):KwirthPodPermissions[] => {
    var clusterPodPermissions:KwirthPodPermissions[]=[]
    if (channelConfig.has('podPermissions')) {
        logger.info(`  Pod permisson evaluation will be performed.`)
        var namespaceList=channelConfig.getConfigArray('podPermissions')
        for (var ns of namespaceList) {
            var namespaceName=ns.keys()[0]
            var podPermissions:KwirthPodPermissions={ namespace:namespaceName }

            if (ns.getConfig(namespaceName).has('allow')) {
                podPermissions.allow=loadPodRules(ns.getConfig(namespaceName), 'allow')
                if (ns.getConfig(namespaceName).has('except')) podPermissions.except=loadPodRules(ns.getConfig(namespaceName), 'except')
                if (ns.getConfig(namespaceName).has('deny')) podPermissions.deny=loadPodRules(ns.getConfig(namespaceName), 'deny')
                if (ns.getConfig(namespaceName).has('unless')) podPermissions.unless=loadPodRules(ns.getConfig(namespaceName), 'unless')
            }
            else {
                podPermissions.allow=[]
                podPermissions.allow.push({
                    pods: [new RegExp('.*')],
                    refs: [new RegExp('.*')]
                })
            }
            clusterPodPermissions.push(podPermissions)
        }
    }
    else {
        logger.info(`  No pod permissions will be applied.`)
    }
    return clusterPodPermissions
}

/**
 * Reads permissions for a kwirth channel (like log, metrics...)
 * @param channel name of the channel
 * @param logger bs logger service
 * @param cluster the app-config object containing the cluster to process
 * @param kdata current KwirthClusterData object to add channel permissions
 */
const addChannelPermissions = (channel: string, logger:LoggerService, cluster:Config, kdata:KwirthClusterData) => {
    let keyname = 'kwirth' + channel

    let keyCamelName = 'kwirth' + channel[0].toUpperCase() + channel.substring(1)
    if (cluster.has(keyCamelName)) keyname = keyCamelName

    if (cluster.has(keyname)) {
        logger.info(`Load permissions for channel ${channel} (config: ${keyname}).`)
        var configChannel=cluster.getConfig(keyname);
        if (configChannel.has('namespacePermissions')) {
            logger.info(`  Loading namespace permissions.`)
            kdata.namespacePermissions.set(channel, loadNamespacePermissions(configChannel, logger))
        }
        else {
            logger.info(`  No namespace permissions.`)
            kdata.namespacePermissions.set(channel, [])
        }
        if (configChannel.has('podPermissions')) {
            logger.info(`  Loading pod permissions.`)
            kdata.podPermissions.set(channel, loadPodPermissions(configChannel, logger))
        }
        else {
            logger.info(`  No pod permissions.`)
            kdata.podPermissions.set(channel, [])
        }
    }
    else {
        logger.info(`Cluster ${cluster.getString('name')} will have no channel '${channel}' restrictions.`)
        kdata.namespacePermissions.set(channel,[])
        kdata.podPermissions.set(channel,[])
    }
}

/**
 * reads app-config and builds a list of valid clusters
 * @param logger core service for logging
 * @param config core service for reading config info
 */
const loadClusters = async (logger:LoggerService, config:RootConfigService) => {
    KwirthStaticData.clusterKwirthData.clear()

    var locatingMethods=config.getConfigArray('kubernetes.clusterLocatorMethods')
    for (var method of locatingMethods) {

      var clusters=(method.getConfigArray('clusters'))
      for (var cluster of clusters) {

        var name=cluster.getString('name')
        if (cluster.has('kwirthHome') && cluster.has('kwirthApiKey')) {   
            var kwirthHome:string = cluster.getOptionalString('kwirthHome')!
            var kwirthApiKey:string = cluster.getOptionalString('kwirthApiKey')!
            var title:string = (cluster.has('title')?cluster.getString('title'):'No name')
            var kwirthClusterData:KwirthClusterData={
                name,
                kwirthHome,
                kwirthApiKey,
                kwirthData: {
                    version: '',
                    clusterName: '',
                    inCluster: false,
                    namespace: '',
                    deployment: '',
                    lastVersion: '',
                    clusterType: ClusterTypeEnum.KUBERNETES,
                    metricsInterval: 0,
                    channels: []
                },
                title,
                namespacePermissions: new Map(),
                podPermissions: new Map(),
                enabled: false
            }

            logger.info(`Kwirth for ${name} is located at ${kwirthClusterData.kwirthHome}. Testing connection...`)
            let enableCluster = false
            try {
                /*
                    /config/info endpoint returns JSON:
                    {
                        "clusterName": "inCluster",
                        "namespace": "default",
                        "deployment": "kwirth",
                        "inCluster": true,
                        "version": "0.4.11",
                        "lastVersion": "0.4.11",
                        "clusterType": "kubernetes",
                        "metricsInterval": 60,
                        "channels": [
                            {
                                "id": "log",
                                "routable": false,
                                "pauseable": true,
                                "modifyable": false,
                                "reconnectable": true,
                                "sources": [
                                    "docker",
                                    "kubernetes"
                                ],
                                "metrics": false
                            },
                            {
                                "id": "alert",
                                "routable": false,
                                "pauseable": true,
                                "modifyable": false,
                                "reconnectable": true,
                                "sources": [
                                    "docker",
                                    "kubernetes"
                                ],
                                "metrics": false
                            },
                            {
                                "id": "metrics",
                                "routable": false,
                                "pauseable": true,
                                "modifyable": true,
                                "reconnectable": true,
                                "sources": [
                                    "kubernetes"
                                ],
                                "metrics": true
                            },
                            {
                                "id": "ops",
                                "routable": true,
                                "pauseable": false,
                                "modifyable": false,
                                "reconnectable": false,
                                "sources": [
                                    "kubernetes"
                                ],
                                "metrics": false
                            },
                            {
                                "id": "trivy",
                                "routable": false,
                                "pauseable": false,
                                "modifyable": false,
                                "reconnectable": false,
                                "sources": [
                                    "kubernetes"
                                ],
                                "metrics": false
                            },
                            {
                                "id": "echo",
                                "routable": false,
                                "pauseable": true,
                                "modifyable": false,
                                "reconnectable": true,
                                "metrics": false,
                                "sources": [
                                    "kubernetes",
                                    "docker"
                                ]
                            }
                        ]
                    }                
                */
                var response = await fetch (kwirthClusterData.kwirthHome+'/config/info')
                try {
                    var data = await response.text()
                    try {
                        var kwirthData = JSON.parse(data) as KwirthData
                        logger.info(`Kwirth info at cluster '${kwirthClusterData.name}': ${JSON.stringify(kwirthData)}`)
                        kwirthClusterData.kwirthData=kwirthData
                        if (versionGreatOrEqualThan(kwirthData.version, MIN_KWIRTH_VERSION)) {
                            enableCluster = true
                        }
                        else {
                            logger.error(`Unsupported Kwirth version on cluster '${name}' (${title}) [${kwirthData.version}]. Min version is ${MIN_KWIRTH_VERSION}`)
                        }
                    }
                    catch (err) {
                        logger.error(`Kwirth at cluster ${kwirthClusterData.name} returned errors: ${err}`)
                        logger.info('Returned data is:')
                        logger.info(data)
                        kwirthClusterData.kwirthData = {
                            version:'0.0.0',
                            clusterName:'unknown',
                            inCluster:false,
                            namespace:'unknown',
                            deployment:'unknown',
                            lastVersion:'0.0.0',
                            clusterType: ClusterTypeEnum.KUBERNETES,
                            metricsInterval: 0,
                            channels: []
                        }
                    }
                }
                catch (err) {
                    logger.warn(`Error parsing version response from cluster '${kwirthClusterData.name}': ${err}`)
                }
            }
            catch (err) {
                logger.info(`Kwirth access error: ${err}.`)
                logger.warn(`Kwirth home URL (${kwirthClusterData.kwirthHome}) at cluster '${kwirthClusterData.name}' cannot be accessed right now.`)
            }

            if (enableCluster) {
                [ InstanceMessageChannelEnum.LOG, 
                  InstanceMessageChannelEnum.ALERT,
                  InstanceMessageChannelEnum.METRICS
                ].map (channel => addChannelPermissions(channel,logger, cluster, kwirthClusterData))
                KwirthStaticData.clusterKwirthData.set(name, kwirthClusterData)
            }
            else {
                logger.warn(`Cluster ${name} will be disabled`)
            }
        }
        else {
            logger.warn(`Cluster ${name} has no Kwirth information (kwirthHome and kwirthApiKey are missing).`)
        }
      }
    }

    logger.info('Kwirth static data has been set including following clusters:')
    for (var c of KwirthStaticData.clusterKwirthData.keys()) {
        logger.info ('  '+c)
    }
    for (var c of KwirthStaticData.clusterKwirthData.keys()) {
        console.log(KwirthStaticData.clusterKwirthData.get(c))
    }

}

export { loadClusters }