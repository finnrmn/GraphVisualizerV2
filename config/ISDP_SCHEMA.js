// src/config/ISDP_SCHEMA.js
const ISDP_SCHEMA = {
    baseUrlKey: "http://localhost:32308", // wir lassen die URL weiter aus settings/Param kommen
    classes: {
        GeoNode: {
            fqn: 'de.bst.ibw.data.topology.GeoNode',
            path: 'payload',
            fields: {id: 'id', x: 'geoCo.x', y: 'geoCo.y', name: 's_name'}
        },
        TrackEdge: {
            fqn: 'de.bst.ibw.data.topology.TrackEdge',
            path: 'payload',
            fields: {
                id: 'id',
                nodeIdA: 'nodeIdA',
                nodeIdB: 'nodeIdB',
                refNodeId: 'refNode',
                lengthM: 'edgeLength.bdValue',
                name: 'names[0].name',
                isdmName: 'isdmNames[0].name',

            },
            elements: {
                elements: "geoElements",
                lines: 'geoLines',
                arcs: 'geoArcs',
                transitions: 'geoTransitions',
                tdsComponents: 'tdsComponentsOnThisEdge',
                trackPoints: "trackPoints",
                signals: "signalsOnThisEdge",
                stations: "stations",
                balises: "datapointsOnThisEdge",
                tdsSections: "trainDetectionSections"
            }
        },
        ETCSDataPoint: {
            fqn: 'de.bst.ibw.data.preversion.ETCSDataPoint',
            path: 'payload',
            fields:{
                id: "id",
                name: "iNid_bg",
                refTrackEdge: "baliseLocations[0].netElementRef",
                intrinsicCoord: "baliseLocations[0].intrinsicCoord",
                applicationDirection: "baliseLocations[0].applicationDirection"
            }
        },
        TdsSection: {
            fqn: 'de.bst.ibw.data.train_detection.TdsSection',
            path: 'payload',
            fields: {
                id: "id",
                name: "name[0].name",
                label: "label",
                refTrackEdge: "location.associatedNetElement.netElementRef",
                geometricCoordinateBegin: "location.associatedNetElement.geometricCoordinateBegin",
                geometricCoordinateEnd: "location.associatedNetElement.associatedNetElement",
                posBegin: "location.associatedNetElement.posBegin",
                posEnd: "location.associatedNetElement.posEnd"
            }
        },
        TdsComponent: {
            fqn: 'de.bst.ibw.data.train_detection.TdsComponent',
            path: 'payload',
            fields:{
                id: "id",
                name: "name[0].name",
                type: "type",
                refTrackEdge: "location.netElementRef",
                linearCoordinate: "location.linearCoordinate",
                geometricCoordinate: "location.geometricCoordinate",
                intrinsicCoord: "location.intrinsicCoord",
                applicationDirection: "location.applicationDirection",
                pos: "location.pos"
            }
        },
        Signalgroup: {
            fqn: 'de.bst.ibw.data.signal.Signalgroup',
            path: "payload",
            fields: {
                id: "id",
                name: "name[0].name",
                dbName: "dbName",
                refTrackEdge: "location.netElementRef",
                linearCoordinate: "location.linearCoordinate",
                geometricCoordinate: "location.geometricCoordinate",
                intrinsicCoord: "location.intrinsicCoord",
                applicationDirection: "location.applicationDirection",
                pos: "location.pos"
            }
        }
    }
};

export default ISDP_SCHEMA;
