# Backstage backend Kwirth plugin 
This Backstage plugin is the backend for several Backstage plugins that we have developed for integrating live streaming Kubernetes observability data (whatever be its type) into Backstage by using Kwirth plugins. It's important to understand that **Kwirth provides different kinds of information** (log, metrics, events, alerts, operations...), and due to this way of working, the whole set of Backstage Kwirth plugins are comprised by:

  - One only backend plugin (**this one**).
  - Several frontend plugins, each one including its own feature set. Typically, there should exist one Backstage Kwirth frontend plugin for each Kwirth supported channel (please refer to information on Kwirth channels here [Kwirth Channels](https://jfvilas.github.io/kwirth/#/channels)).
   One common plugin, containing common artifactos to use by frontend plugins and backend plugin.

This [Backstage]((https://backstage.io)) backend plugin is primarily responsible for the following tasks:

- Reading Kwirth config from your app-config YAML file.
- Performing login processes to remote Kwirth instances, and thus obtaining valid API keys for users to stream kubernetes data.
- Receiving and answering API calls from configured frontend Kwirth plugins on your Backstage instance.

## Version compatibility
Following table shows version compatibility between Kwirth Backstage plugin and Kwirth Core server.

| Plugin Kwirth version | Kwirth version |
|-|-|
|0.0.1|0.3.155|
|0.0.2|0.4.20|

## Install plugin
Here we show how to get this backend plugin up and running quickly. First we need to add the `@jfvilas/plugin-kwirth-backend` package to your Backstage project:

```sh
# From your Backstage root directory
yarn --cwd packages/backend add @jfvilas/plugin-kwirth-backend @jfvilas/plugin-kwirth-common @jfvilas/kwirth-common
```

### Taylor your New Backend System (we don't work with old backend system)
Next, you need to modify your backend index file for starting Kwirth backend plugin when your Backstage instance starts. In your `packages/backend/src/index.ts` make the following change:

```diff
    const backend = createBackend();

    // ... other feature additions

+   backend.add(import('@jfvilas/plugin-kwirth-backend'));

    // ... other feature additions

    backend.start();
```

## Configure
To have your Kwirth backend plugins ready for work you must perform some previous additional tasks, like deploying Kwirth, creating API Keys, defining clusters, etc... In this section we cover all these needs in a structured way.

Remember, frontend Backstage Kwirth plugins help you in showing live-streaming kubernetes observability data inside Backstage to ease your develoment teams work, but take into account that **this Backstage backend plugin has no access to the kubernetes itself**, it relies on a Kwirth deployment to act as a "*live-streaming data proxy*", that is, Kwirth (a component that runs inside your Kubernetes clusters) has access to kubernetes data and can "export" that data outside the cluster in a reliable and secure way, so kubernetes data can be consumed anywhere. For example, logs can be shown on Backstage entity pages, kubernetes metrics can be charted on your Backstage, you can receive alerts or security information related to your pods (based on [Trivy Operator](https://github.com/aquasecurity/trivy-operator)) etc.

### 1. Kwirth installation
We will not cover a detailed approach on this subject here, we refer you to [Kwirth installation documentation](https://jfvilas.github.io/kwirth/#/0.4.20/installation) where you will find more information on how Kwirth works and how to install it. We show here just a summary of what is Kwirth:

1. Kwirth is built around the **one-only-pod concept**.
2. Kwirth doesn't need any persistenace layer (no database, no network storage, no block storage, no file storage). It uses only Kubernetes control-plane storage.
3. Kwirth includes user management, API security and multi-cluster access.
4. Kwirth can export **kubernetes observability data in real-time** wherever you need it.
5. The kind of observability data you need is served by differnet [Kwirth channels](https://jfvilas.github.io/kwirth/#/0.4.20/channels?id=channels).

### 2. Kwirth server customization
Once you have a Kubernetes cluster with a Kwirth installation in place (in order to export kuberntes data, Kwirth must be accesible from outside your cluster, so you will need to install any flavour of Ingress Controller and an Ingress for publishing Kwirth access). Please **write down your Kwirth external access URL** (we will need it for configuring Kwirth backend plugin). In order to simplify this tutorial we will assume your Kwirth is published on: **http://your-external.dns.name/kwirth**.

Once Kwirth is running, you need to enter Kwirth front application to perform two simple actions:

1. Login to your Kwirth and access the [API Key section](https://jfvilas.github.io/kwirth/#/apimanagement?id=api-management) to create an API Key that we will use for giving our Backstage Kwirth plugin the chance to connect to your Kwirth server and access kubernetes observability data.
2. Create an API Key following this procedures:
     - On the main menu (the burger icon) select 'API Security'.
     - Click 'NEW' button on the bottom-left side of the dialog.
     - Enter some description on the right, like 'API key for my Backstage instance'.
     - Enter lease time (is the number of days the API Key will be valid).
     - Don't worry about key type, it is fixed with 'permanent' value.
     - On the 'Scopes' combo check only 'cluster' option.
     - Click 'Save' on the bottom-right side for saving this resource access into your API key.
     - Now click on th 'SAVE' button on the bottom-left side for saving this API Key.
3. API Key should appear on the API Key list, inlcuding its expiration date.
4. Select your API Key (clicking on it) and click on bottom-left 'COPY' button for copying the API Key that you will add to your app-config YAML file.

**NOTE:** Depending on the version of Kwirth you have deployed, maybe you find a dialog for performing all these actions automatically the first time you log in with the admin user.

This is all you need to do inside Kwirth. You can also do some play on Kwirth front application, it's very funny, I fully recommend it !!!

### 3. Backstage base configuration
For finishing this backend Kwirth plugin configuration you need to **edit your app-config.yaml** in order to add Kwirth information to your Kubernetes cluster. Kwirth plugin doesn't have a specific section in the app-config, Kwirth just **uses the Backstage Kubernetes core component configuration** vitamined with some additional properties. Let's suppose you have a Kubernetes configuration like this in your current app-config.yaml:

```yaml
kubernetes:
  serviceLocatorMethod:
    type: 'multiTenant'
  clusterLocatorMethods:
    - type: 'config'
      clusters:
        - url: https://kuebeapi.your-cluster.com
          name: k3d-cluster
          title: 'Kubernetes local'
          authProvider: 'serviceAccount'
          skipTLSVerify: true
          skipMetricsLookup: true
```

For using Kwirth Backstage plugin we need to add (at least) 2 properties to the cluster configuration:
- kwirthHome: the home URL of the Kwirth installation.
- kwirthApiKey: the API key we created before (and should be kept in your clipboard).

The kubernetes section should look now something like this:

```diff
kubernetes:
  serviceLocatorMethod:
    type: 'multiTenant'
  clusterLocatorMethods:
    - type: 'config'
      clusters:
        - url: https://kuebeapi.your-cluster.com
          name: k3d-cluster
          title: 'Kubernetes local'
+         kwirthHome: http://your-external.dns.name/kwirth
+         kwirthApiKey: '40f5ea6c-bac3-df2f-d184-c9f3ab106ba9|permanent|cluster::::'
          authProvider: 'serviceAccount'
          skipTLSVerify: true
          skipMetricsLookup: true
```

### 4. Channels
Kwirth live-streaming system can export different kinds of data: log streaming, metrics streaming, alerts, events, security posture... In Kwirth, these different types of data are grouped in what we call **channels**. In fact, each channel may be viewed as an independent data service (please refer here to learn how the channel system works [Kwirth channels](https://jfvilas.github.io/kwirth/#/0.4.20/channelarch?id=channels)).

Each Kwirth channel is functionally mapped to a Kwirth frontend plugin, and thus, there exist a specific configuration for each channel. So:

 - For the Kwirth metrics streaming channel, you should use the 'plugin-kwirth-metrics' frontend plugin.
 - For the Kwirth real-time log channel, you should use the 'plugin-kwirth-log' frontend plugin.
 - For the Kwirth cybersecurity channel (named trivy channel), you should use the 'plugin-kwirth-trivy' frontend plugin.
 - For the Kwirth alert channel, you should use the 'plugin-kwirth-alert' frontend plugin.
 - ...

In your app-config.yaml configuration file you must configure each one of the channels. Let's show an example of 'log' and 'alert' channels:
```yaml
kubernetes:
  serviceLocatorMethod:
    type: 'multiTenant'
  clusterLocatorMethods:
    - type: 'config'
      clusters:
        - url: https://kuebeapi.your-cluster.com
          name: k3d-cluster
          title: 'Kubernetes local'
          kwirthHome: http://your-external.dns.name/kwirth
          kwirthApiKey: '40f5ea6c-bac3-df2f-d184-c9f3ab106ba9|permanent|cluster::::'
          authProvider: 'serviceAccount'
          skipTLSVerify: true
          skipMetricsLookup: true
          kwirthlog:
            namespacePermissions:
              - kube-system: []
              - ingress-nginx: []
            podPermissions:
          kwirthalert:
            namespacePermissions:
            podPermissions:
              - pro:
                  allow:
                  - refs: []
```

As you may see, channel configuration takes place inside your Backstage cluster configuration, because, as we said before, Kwirth plugin **uses the Backstage Kubernetes core component configuration**.

So, for adding 'log' and 'alert' channel we have created two sections: 'kwirthlog' and 'kwirthalert'. The content of channel sections inside the app-config file is explained bellow, it is just the permission system.

### 4. Permissions

#### Introduction to the permission system
The permission system of Kwirth plugin for Backstage has been designed with these ideas in mind:

  - **Keep it simple**, that is, people that don't want to get complicated should be able to configure permissions without a headache, using just a few lines (in some cases even with 0 lines)
  - It must be **flexible**. Because *every house is a world*, the system should be flexible enough to accomodate every single permission need, whatever its size be.

So, the permission system has been build using (right now) two layers:

  1. **Namespace layer**. Assigning permissions to whole namespaces can be done in a extremely simple way using this layer.
  2. **Pod layer**. If namespace permission layer is not coarse enough for you, you can refine your permissions by using the pod permission layer. In addition, the pod layer allows adding scopes to the different permissions you can assign.


#### Namespace layer
Let's suppose that you have 3 namespaces in your cluster:
  - **dev**, for development workloads.
  - **stage**, for canary deployments, a/b testing and so on.
  - **production**, for productive workloads.

Let's build a sample situation. Typically, you would restrict access to kubernetes information in such a way that:
  - Everybody should be able to view developoment (dev) logs.
  - Only Operations (devops) teams and Administrators can view stage logs.
  - Only Administrators can see production logs. In addition to administrators, production can also be accessed by Nicklaus Wirth.

The way you can manage this in Kwirth plugin is **via Group entities** of Backstage. That is:
  - You create a group where you can add all your developers.
  - Another group with your devops team.
  - And a group containing just the Administrators.

**NOTE**: for simplicity we assume all your User refs and Group refs live in a Backstage namespace named 'default'

Once you have created the groups you can configure the namespace permission adding one additional property to the cluster definition, it is named '**namespacePermissions**'. This is an array of namespaces, where for each namespace you can declare an array of identity refs (that is, users or groups). The example below is self-explaining (in this example we are **configuring the plugin for the 'log' channel**).

```diff
      clusters:
        - url: https://kuebeapi.your-cluster.com
          name: k3d-cluster
          title: 'Kubernetes local'
          kwirthHome: http://your-external.dns.name/kwirth
          kwirthApiKey: '40f5ea6c-bac3-df2f-d184-c9f3ab106ba9|permanent|cluster::::'
          kwirthlog:
+           namespacePermissions:
+             - stage: ['group:default/devops', 'group:default/admin']
+             - production: ['group:default/admin', 'user:default/nicklaus-wirth']
          authProvider: 'serviceAccount'
          skipTLSVerify: true
          skipMetricsLookup: true
```

It's easy to understand:
  1. Everybody can access 'dev' namespace, since we have stated *no restrictions* at all (we added no 'dev' namespace in the namespacePermissions)
  2. 'stage' namespace can be accessed by group 'devops' and group 'admin'.
  3. The 'production' namespace can be accessed by the group of administrators ('admin' group) and the user Nicklaus Wirth ('nicklaus-wirth').
  
**Remember, if you don't want to restrict a namespace, just do not add it to the configuration in app-config file, like we have done with 'dev' namespace.**

When a user working with Backstage enters a Kwirth tab (log, metrics or whatever) in the entity page, he will see a list of clusters. When he selects a cluster, a list of namespaces will be shown, that is, all namespaces that do contain pods tagged with the current entity id. If the user has no permission to a specific namespace, the namespace will be shown in <span style='color:red'>red</span> and will not be accesible. Allowed namespaced will be shown in <span style='color:blue'>**primary color**</span> and will be 'clickable'.


#### Pod permissions
In addition to namespace permissions, Kwirth plugin has added a pod permission layer in which you can refine your permissions.

Let's consider a simple view-scoped pod permission sample based on previously defined namespaces: 'dev', 'stage', 'production':

```diff
      clusters:
        - url: https://kuebeapi.your-cluster.com
          name: k3d-cluster
          title: 'Kubernetes local'
          kwirthHome: http://your-external.dns.name/kwirth
          kwirthApiKey: '40f5ea6c-bac3-df2f-d184-c9f3ab106ba9|permanent|cluster::::'
          authProvider: 'serviceAccount'
          skipTLSVerify: true
          skipMetricsLookup: true
          kwirthlog:
            namespacePermissions:
              - stage: ['group:default/devops', 'group:default/admin']
              - production: ['group:default/admin', 'user:default/nicklaus-wirth']
+           podPermissions:
+             - stage:
+                 allow:
+                 - pods: [^common-]
+                 - pods: [keys]
+                   refs: []
+                 - pods: [^ef.*]
+                   refs: [group:.+/admin, group:test/.+]
+                 - pods: [th$]
+                   refs: [.*]
+                 except:
+                 - pods: [kwirth]
+                   refs: [group:default/admin, user:defualt:nicklaus-wirth]
+             - production
+                 deny:
+                 - refs: [.*]
+             - others
+                 allow:
+                 - refs: []
          ...
```

***VERY IMPORTANT NOTE:*** **All strings defined in the pod permission layer are regular expressions.**

About this example and about 'how to configure Kwirth plugin pod permissions':

  - **podPermissions** is the section name for refining pod permission (inside a specific channel like 'kwirthlog' or 'kwirthmetrics').
  - The main content of this section is a list of namespaces (like 'stage' in the sample).
  - The content of each namespace is a rule system that works this way:
    - Rules can be defined following a fixed schema by which you can **allow** or **deny** access to a set of pods from a set of identity references (users or groups)
    - 'allow' can be refined by adding exceptions by means of 'except' keyword.
    - 'deny' can be refined by adding exceptions by means of 'unless' keyword.
    - The way rules are evaluated is as follows:
       1. Search for a pod name match in the allow section.
       2. If a match is found, look for any exception that may be applied, by searching for matches in the 'except' section.
       3. If no 'allow' is found, or an allow rule is found but there exists an except rule that matches, the access is not granted and the process finishes here.
       4. If the user is granted, Kwirth plugin looks then for a match in the 'deny' section.
       5. If there are no deny rules that match, the user is granted and the process finsihes here.
       6. If a deny rule matches, then Kwirth plugin will search for any 'unless' rule that matches. If no 'unless' rule match exists, the access is denied and the process finishes here.
       7. If there exists an 'unless' rule then the access is granted.
    - It is important to note that 'allow' and 'deny' are optional, but if you don't specify them, they will match anything.
  - It is even most important to know that **if a namespace is not specified, the access is granted**.

So, in our example:
  - Access to 'dev' is granted, since 'dev' namespace is not specified.
  - Access to 'stage' works this way:
    - *Everybody can access pods whose name starts with 'common-'* (remember, **we always use regexes**). We have added no 'refs', so any identity ref matches.
    - *Nobody can access pod named 'keys'* (pay attention to the refs set to '[]', that means **no identity ref can access**)
    - *Admins and people on namespace 'test' can access any pod whose name starts with 'ef'*. The 'pods' contains a regex with '^ef.*' (starts with 'ef' and contain any number of characters afterwards). The identity refs that can access pods that match with this pod regex are the group of admins on any Backstage namespace ('group:.+/admin') and all the people that belongs to Backstage group 'test' (group:test/.+).
    - *Everybody can access pods whose name ends with 'th'*. That is, the regex in pods is 'th$' (names ending with 'th'), and the refs contains '.*', that is, any number of characters, so there are no limits on the refs, everybody is included (it is the same behaviour as not adding the 'refs', everybody can)
    - *But... if the pod name is 'kwirth' only admis can access*. This refers to the 'except' section, which is a refinement of the allow. Although the previous rule says *everybody can access pods ending with 'th'*, this is true **except** for the pod name 'kwirth', which can only be accesed by 'admins in the default' group or 'Nicklaus Wirth'.

Let's complete the example with the other namespaces declared:
  - *Nobody can access pods in 'production' namespace*. The 'production' namespace doesn't have an 'allow' section, it ony contains a 'deny'. In addition, the 'deny' section only contains a 'refs' section (all pod names would match, since no 'pods' section means 'pods: [.*]', that is, all pod names match). The 'refs' inside the 'deny' contains '.*', what means every ref would match, so, finally, *nobody can access a pod*.
  - *Nobody can access pods in 'others' namespace*. The 'others' namespace contains just an 'allow' rule, which have no pods (so all pod names would match), and it contains in the 'refs' this expression: '[]', so no identity ref would match. Finally, *nobody can access a pod*, the same as 'production' but achieved in other way.

Please be aware that not declaring 'pods' or 'refs' means using a **match-all** approach (like using ['.*']), what is completely different than declaring '[]', what **matches nothing**.
