param a string = 'dev'
param b string = 'eastus'
param c int = 2
param d string = 'Standard_B1s'
resource v 'Microsoft.Network/virtualNetworks@2020-11-01' = {
  name: 'vnet${a}'
  location: b
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.0.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'default'
        properties: {
          addressPrefix: '10.0.0.0/24'
        }
      }
    ]
  }
}
resource s 'Microsoft.Network/networkSecurityGroups@2020-11-01' = {
  name: 'nsg${a}'
  location: b
  properties: {
    securityRules: [
      {
        name: 'r1'
        properties: {
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '80'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
          access: 'Allow'
          priority: 100
          direction: 'Inbound'
        }
      }
    ]
  }
}
resource n 'Microsoft.Network/networkInterfaces@2020-11-01' = [for i in range(0, c): {
  name: 'nic${a}${i}'
  location: b
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig'
        properties: {
          subnet: {
            id: v.properties.subnets[0].id
          }
          privateIPAllocationMethod: 'Dynamic'
        }
      }
    ]
    networkSecurityGroup: {
      id: s.id
    }
  }
}]
resource vm 'Microsoft.Compute/virtualMachines@2020-06-01' = [for i in range(0, c): {
  name: 'vm${a}${i}'
  location: b
  properties: {
    hardwareProfile: {
      vmSize: d
    }
    osProfile: {
      computerName: 'vm${i}'
      adminUsername: 'admin'
      adminPassword: 'Passw0rd!'
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'UbuntuServer'
        sku: '18.04-LTS'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
      }
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: n[i].id
        }
      ]
    }
  }
}]
var ipList = [
  {
    name: 'ip1'
    address: '10.0.0.1'
  }
  {
    name: 'ip2'
    address: '10.0.0.2'
  }
  // Add more objects as needed
]

output ipList array = ipList
