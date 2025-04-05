import { KwirthData } from '@jfvilas/kwirth-common';

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

export type KwirthNamespacePermissions = {
    namespace: string
    identityRefs: string[]
}

/*
    SAMPLE Values

    {
        home: 'http://localhost/kwirth',
        apiKey: 'dce1611c-b3d8-6d90-3507-64046112044e|permanent|cluster::::',
        title: 'Kubernetes local',
        namespacePermissions: [ { namespace: 'pre', identityRefs: [Array] } ],
        viewPermissions: [
            { namespace: 'test', allow: [Map] },
            { namespace: 'pre', restrict: [Map] },
            { namespace: 'staging', allow: [Map], restrict: [Map]  },
            { namespace: 'corporate', allow: [Map] },
            { namespace: 'pro', allow: [Map], restrict: [Map] }
        ],
        restartPermissions: [
            { namespace: 'dev', allow: [Map], restrict: [Map], restrict: [Map] },
            { namespace: 'pre', allow: [Map], restrict: [Map] }
        ]
    }    
*/

/**
 * @field pods: an array of RegExp build from the expressions that indentify pods
 * @field refs: an array of RegExp build from the expressions that indentify refs
 */
export type PodPermissionRule = {
    pods: RegExp[]
    refs: RegExp[]
}

/**
 * @type KubelogNamespacedPodPermissions is the whole permissions that must be checked for a pod access in order to execute an action (view, restart...)
 * @field namespace is the namespace where this permission set must be applied (permissions maybe different for different namespaces, obviously)
 * @field allow: at least un rule in the allow must be fulfilled for the user to have access to the pod
 * @field except: if, after processsing 'allow', a rule in the except set evaluates to false the access is not allowed
 * @field deny: if a rule in the deny set evaluates to true then the access is denied
 * @field unless: if, after processing 'deny', we found at least one 'unless' rule that evaluates to true, access is granted
 */
export type KwirthPodPermissions = {
    namespace: string
    allow?: PodPermissionRule[]
    except?: PodPermissionRule[]
    deny?: PodPermissionRule[]
    unless?: PodPermissionRule[]
}

export type KwirthClusterData = {
    name: string
    enabled: boolean
    kwirthData: KwirthData
    kwirthHome: string
    kwirthApiKey: string
    title: string

    // the string is one of: 'chart', 'log', 'ops'...
    namespacePermissions:Map<string,KwirthNamespacePermissions[]>
    podPermissions: Map<string,KwirthPodPermissions[]>
}
