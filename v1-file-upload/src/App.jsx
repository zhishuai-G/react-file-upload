import { useState } from 'react'
import { Progress, Button } from 'antd';
import './App.css'

const chunkSize = 1 * 1024 * 1024; // 切片大小 1M
const maxRequest = 6; // 最大并发数

function App() {
  const [uploadFileList, setUploadFileList] = useState([]); // 待上传文件列表

  const handleUploadFile = (e) => {
    console.log(e.target.files)
    const files = e.target.files;
    if (!files || !files.length) {
      return alert('请选择文件');
    } else {
      Array.from(files).forEach(async (item, index) => {
        const file = item
        let inTaskArrItem = {
          id: new Date() + index, // 因为forEach是同步，所以需要用指定id作为唯一标识
          state: 0, // 0-待解析，1-解析中，2-上传中，3-上传完成，4-上传失败
          fileHash: '',
          fileName: file.name,  // 文件名
          fileSize: file.size,  // 文件大小
          allChunkList: [],  // 所有请求的数据
          whileRequests: [], // 正在请求中的请求个数,目前是要永远都保存请求个数为6
          finishNumber: 0,  //请求完成的个数
          errNumber: 0,  // 报错的个数,默认是0个,超多3个就是直接上传中断
          percentage: 0, // 单个文件上传进度条
        };
        // 更新上传列表
        setUploadFileList([...uploadFileList, inTaskArrItem]);
        inTaskArrItem.state = 1; // 解析中
        // 文件大小为0直接取消该文件上传
        if (file.size === 0) {
          setUploadFileList((prevList) => { return prevList.filter((_, idx) => idx !== index) })
        }
      });
    }
  }
  return (
    <>
      <div>
        <input
          type="file"
          onChange={handleUploadFile}
          multiple={false}
        />
      </div>
      {
        uploadFileList.map((item, index) => (
          <div key={item.id} style={{ display: 'flex', marginTop: '10px' }}>
            <div style={{ width: '300px' }}>
              <div>
                <Progress value={item?.percentage} style={{ width: '100%' }}></Progress>
                <div style={{ marginLeft: '4px' }}>
                  {item.state === 1 && <p>正在解析中...</p>}
                  {item.state === 2 && <p>正在上传中...</p>}
                  {item.state === 3 && <p>上传完成</p>}
                  {item.state === 4 && <p>上传失败</p>}
                </div>
              </div>
            </div>
            {![0, 1].includes(item.state) && (
              <Button color="danger" variant="solid" style={{ marginLeft: '10px', height: '40px' }}>取消</Button>
            )}
          </div>
        ))
      }
    </>
  )
}

export default App
