export const assertTransactionSupport = async (connection) => {
  const hello = await connection.db.admin().command({ hello: 1 });
  const supported = Boolean(hello.setName || hello.msg === "isdbgrid");

  if (!supported) {
    throw new Error(
      "MongoDB transactions require a replica set or sharded cluster; standalone MongoDB is not supported."
    );
  }
};
