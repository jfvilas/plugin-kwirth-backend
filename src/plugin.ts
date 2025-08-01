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

import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api'
import { createRouter } from './service/router'

export const kwirthPlugin = createBackendPlugin({
    pluginId: 'kwirth',
    register(env) {
        env.registerInit({
            deps: {
                discovery: coreServices.discovery,
                config: coreServices.rootConfig,
                logger: coreServices.logger,
                auth: coreServices.auth,
                httpAuth: coreServices.httpAuth,
                httpRouter: coreServices.httpRouter,
                userInfo: coreServices.userInfo
            },
            async init({ discovery, config, httpRouter, logger, auth, httpAuth, userInfo }) {
                httpRouter.use(
                    await createRouter({
                        discoverySvc: discovery,
                        configSvc: config,
                        loggerSvc: logger,
                        authSvc: auth,
                        httpAuthSvc: httpAuth,
                        userInfoSvc: userInfo
                    })
                )
            }
        })
    }
})
