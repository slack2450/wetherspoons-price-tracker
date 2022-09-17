import { QueryCommand } from '@aws-sdk/lib-dynamodb';

const TableName = 'wetherspoons-pubs';

export const handler = async() => {
    const query = new QueryCommand({
        TableName,
        KeyConditionExpression: '#i = :k',
        ExpressionAttributeValues: {
            ':k': Number(event.pathParameters.venueId),
        },
        ExpressionAttributeNames: {
            '#i': 'date',
        }
    })
}